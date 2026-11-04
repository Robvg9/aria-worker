export interface MissionSubmissionRequestIdentityInput {
  userId: string;
  goal: string;
  projectId?: string | null;
  storage?: Storage;
  now?: () => number;
  createRequestId?: () => string;
}

export declare function getOrCreateMissionSubmissionRequestIdV1(
  input: MissionSubmissionRequestIdentityInput,
): Promise<string>;

export declare function clearMissionSubmissionRequestIdV1(
  input: MissionSubmissionRequestIdentityInput,
): Promise<void>;
