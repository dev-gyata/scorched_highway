// Every map in the game. Import this once at startup; it registers them all (see registry.ts).
import { registerMap } from './registry';
import { boneyard } from './boneyard';
import { ghostTown } from './ghost-town';
import { route67 } from './route67';
import { saltLake } from './saltlake';

for (const m of [ghostTown, route67, saltLake, boneyard]) registerMap(m);
