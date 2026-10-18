import { asDate, todayISO } from './lib/dates';
import { prisma } from './lib/prisma';

let timer: NodeJS.Timeout | undefined;

export function startJobs() {
  if (process.env.NODE_ENV === 'test') return;
  const run = () => {
    runMaintenance().catch(async (error) => {
      await prisma.backgroundJob.create({
        data: {
          type: 'MAINTENANCE',
          status: 'FAILED',
          payload: {},
          lastError: error instanceof Error ? error.message : 'Dështim',
          runAt: new Date(),
          finishedAt: new Date(),
          attempts: 1,
        },
      });
    });
  };
  timer = setInterval(run, 60 * 60 * 1000);
  timer.unref?.();
  run();
}

export async function runMaintenance() {
  const started = new Date();
  const today = todayISO();
  await prisma.task.updateMany({
    where: {
      dueDate: { lt: asDate(today) },
      status: { in: ['NEW', 'IN_PROGRESS', 'WAITING_DOCUMENTS', 'IN_REVIEW'] },
    },
    data: { status: 'OVERDUE' },
  });
  await prisma.invoice.updateMany({
    where: { status: 'ISSUED', dueDate: { lt: asDate(today) } },
    data: { status: 'OVERDUE' },
  });
  const expiredTrials = await prisma.subscription.findMany({
    where: { status: 'TRIAL', trialEndsAt: { lt: started }, readOnly: false },
  });
  for (const subscription of expiredTrials) {
    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'EXPIRED', readOnly: true } });
    await prisma.subscriptionEvent.create({
      data: {
        firmId: subscription.firmId,
        subscriptionId: subscription.id,
        type: 'TRIAL_EXPIRED',
        note: 'Prova mbaroi. Qasja kalon në vetëm-lexim dhe regjistrimet mbeten.',
      },
    });
  }
  const soon = new Date(`${today}T00:00:00.000Z`);
  soon.setUTCDate(soon.getUTCDate() + 3);
  const tasks = await prisma.task.findMany({
    where: { status: { not: 'COMPLETED' }, assigneeId: { not: null }, dueDate: { lte: soon } },
  });
  for (const task of tasks) {
    if (!task.assigneeId) continue;
    await prisma.notification.upsert({
      where: { userId_dedupeKey: { userId: task.assigneeId, dedupeKey: `task-reminder:${task.id}` } },
      update: {},
      create: {
        userId: task.assigneeId,
        firmId: task.firmId,
        companyId: task.companyId,
        type: 'TASK_DUE',
        title: 'Afati i detyrës po afrohet',
        body: task.title,
        dedupeKey: `task-reminder:${task.id}`,
      },
    });
  }
  await prisma.backgroundJob.create({
    data: {
      type: 'MAINTENANCE',
      status: 'SUCCEEDED',
      payload: { overdueTasksChecked: true, reminders: tasks.length },
      runAt: started,
      startedAt: started,
      finishedAt: new Date(),
    },
  });
}
