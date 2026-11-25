// Product-owned legacy markers are ignored when reading manual checkpoint prose.
import { checkpointCodec } from '@voidcorp/mission-engine/session';
import { PRODUCT_IDENTITY } from '../identity.js';

export const {
  parseCheckpoint,
} = checkpointCodec(PRODUCT_IDENTITY.markers.contextContinuity);
