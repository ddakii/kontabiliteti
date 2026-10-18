# Kufijtë e qiramarrjes

| Model | Kufiri |
| --- | --- |
| User, Session | Përdoruesi. Sesioni nuk jep qasje te një zyrë pa anëtarësi. |
| AccountingFirm dhe FirmSettings | Zyra. |
| FirmMembership, Role e firmës, Invitation | Zyra. Rolet e sistemit kanë `scopeKey = system` dhe nuk përmbajnë të dhëna klienti. |
| ClientCompany dhe të gjitha modelet me `companyId` | Kompania brenda zyrës. Pyetja duhet të përfshijë edhe `firmId`. |
| Invoice, PurchaseInvoice, Payment, JournalEntry, Document, TaxReport, Employee, PayrollRun | Kompania. Linjat e dokumentit trashëgojnë kompaninë e kryes. |
| Subscription, BillingInvoice | Zyra. Nuk përmbajnë të ardhurat e klientëve. |
| AuditLog | Zyra dhe, kur ka, kompania. Nuk ruan fjalëkalime. |
| PlatformSetting, SubscriptionPlan | Platforma. Pa të dhëna financiare të klientit. |
| SupportAccessGrant | Qasje e kufizuar, me afat dhe e audituar. Pa të, administratori nuk lexon profilin e kompanisë. |

Kalimi i kompanisë në ndërfaqe pastron pyetjet e kompanisë së mëparshme. Serveri përsëri e verifikon kompaninë.
