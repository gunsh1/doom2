// Runtime form of info.c: State and MobjInfo objects built from the generated tables.
// Action functions live in the p_* modules and are attached with registerActions().
import { stateData, mobjinfoData, MOBJ_FIELDS, type ActionName } from '../generated/info_data';
export { S, MT, SPR, sprnames, NUMSTATES, NUMMOBJTYPES, NUMSPRITES } from '../generated/info_data';
export type { ActionName };

export type ActionFn = (actor: any, psp?: any) => void;

export class State {
  action: ActionFn | null = null;
  next!: State;
  constructor(
    readonly index: number,
    public sprite: number,
    public frame: number,
    public tics: number,
    readonly actionName: ActionName | null,
    readonly nextstate: number,
    public misc1: number,
    public misc2: number,
  ) {}
}

export const states: State[] = stateData.map(([spr, frame, tics, act, next, m1, m2], i) => new State(i, spr, frame, tics, act, next, m1, m2));
for (const st of states) st.next = states[st.nextstate];

export interface MobjInfo {
  doomednum: number;
  spawnstate: number;
  spawnhealth: number;
  seestate: number;
  seesound: number;
  reactiontime: number;
  attacksound: number;
  painstate: number;
  painchance: number;
  painsound: number;
  meleestate: number;
  missilestate: number;
  deathstate: number;
  xdeathstate: number;
  deathsound: number;
  speed: number;
  radius: number;
  height: number;
  mass: number;
  damage: number;
  activesound: number;
  flags: number;
  raisestate: number;
}

export const mobjinfo: MobjInfo[] = mobjinfoData.map((row) => {
  const o: Record<string, number> = {};
  MOBJ_FIELDS.forEach((f, i) => (o[f] = row[i]));
  return o as unknown as MobjInfo;
});

const registered = new Map<string, ActionFn>();

export function registerActions(fns: Partial<Record<ActionName, ActionFn>>): void {
  for (const [name, fn] of Object.entries(fns)) {
    registered.set(name, fn as ActionFn);
    for (const st of states) if (st.actionName === name) st.action = fn as ActionFn;
  }
}

/** Names referenced by states that have no implementation registered (for tests). */
export function unregisteredActions(): string[] {
  const missing = new Set<string>();
  for (const st of states) if (st.actionName && !registered.has(st.actionName)) missing.add(st.actionName);
  return [...missing];
}
