export type AccessScope = 'ALL_COMPANIES' | 'ASSIGNED';

export type AuthUser = {
  userId: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
  sessionId: string;
};

export type FirmActor = AuthUser & {
  firmId: string;
  membershipId: string;
  roleKey: string;
  accessScope: AccessScope;
  permissions: Set<string>;
  readOnly: boolean;
};

export type CompanyActor = FirmActor & {
  companyId: string;
};

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      auth?: AuthUser;
      firm?: FirmActor;
      company?: CompanyActor;
    }
  }
}

export {};
