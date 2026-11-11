import type { Breed, DogState } from './Mascot.tsx';

/**
 * Who is on stage. Every pipeline stage belongs to one dog:
 *   plan → Biscuit · memory → Bones · recheck → Watch · search → Scout · writing → Biscuit
 * A turn produces a trail of hand-offs, and the director plays it back with a
 * minimum time per dog, because some stages (memory lookup) take milliseconds.
 */

export function breedForStep(stepId: string): Breed | null {
  if (stepId === 'plan') return 'biscuit';
  if (stepId === 'memory') return 'bones';
  if (stepId.startsWith('recheck')) return 'watch';
  if (stepId.startsWith('search')) return 'scout';
  return null;
}

/** Event as the trail sees it: a step starting, or answer text arriving. */
export type StageEvent = { type: 'step-start'; id: string } | { type: 'text' };

/** Appends a hand-off when a stage starts that belongs to a different dog than the last one. */
export function withStage(trail: Breed[], event: StageEvent): Breed[] {
  const breed = event.type === 'text' ? 'biscuit' : breedForStep(event.id);
  if (!breed || trail[trail.length - 1] === breed) return trail;
  return [...trail, breed];
}

/** What the dog on stage is doing, from its job. */
export function stateForBreed(breed: Breed, hasText: boolean): DogState {
  if (breed === 'scout' || breed === 'watch') return 'searching';
  if (breed === 'bones') return 'remembering';
  return hasText ? 'answering' : 'thinking';
}

/** What each dog is doing for the current question. "resting" = not needed for it. */
export type CrewState = 'resting' | 'working' | 'waiting' | 'done';
export type Crew = Record<Breed, CrewState>;

/**
 * The real, concurrent status of the whole pack for one turn, straight from the
 * pipeline's steps (unlike the stage, which shows one dog at a time).
 * Biscuit plans first and writes last; in between it waits for the others.
 */
export function crewStatus(
  steps: { id: string; status: 'running' | 'done' | 'failed' }[],
  turn: { busy: boolean; hasText: boolean },
): Crew {
  const crew: Crew = { biscuit: 'resting', scout: 'resting', bones: 'resting', watch: 'resting' };

  for (const s of steps) {
    const breed = breedForStep(s.id);
    if (!breed || breed === 'biscuit') continue;
    if (s.status === 'running' && turn.busy) crew[breed] = 'working';
    else if (crew[breed] !== 'working') crew[breed] = 'done';
  }

  if (steps.length > 0 || turn.hasText) {
    const planning = steps.some((s) => s.id === 'plan' && s.status === 'running');
    const othersWorking = (['scout', 'bones', 'watch'] as const).some((b) => crew[b] === 'working');
    if (!turn.busy) crew.biscuit = 'done';
    else if (planning || (turn.hasText && !othersWorking)) crew.biscuit = 'working';
    else crew.biscuit = othersWorking ? 'waiting' : 'working';
  }
  return crew;
}

/** Minimum time a dog stays on stage; shorter when hand-offs are piling up so the stage catches up. */
export function holdTime(behind: number): number {
  return behind > 2 ? 550 : 1100;
}
