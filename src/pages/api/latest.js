import { json, route } from '../../../server/util.js';
import { latestVersion } from '../../../server/latest.js';

// GET /api/latest → { current, latest, behind }: is a newer MyShelf out? (the "Update available" pill)
export const GET = route(async ({ env }) => json(await latestVersion(env)));
