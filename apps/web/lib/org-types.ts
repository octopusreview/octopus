export const ORG_TYPE = {
  STANDARD: 1,
  COMMUNITY: 2,
  FRIENDLY: 3,
} as const;

export type OrgType = (typeof ORG_TYPE)[keyof typeof ORG_TYPE];
