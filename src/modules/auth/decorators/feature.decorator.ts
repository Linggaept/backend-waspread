import { SetMetadata } from '@nestjs/common';

export type FeatureType = 'analytics' | 'ai' | 'leadScoring' | 'followup';

export const FEATURE_KEY = 'required_feature';
export const RequireFeature = (feature: FeatureType) =>
  SetMetadata(FEATURE_KEY, feature);
