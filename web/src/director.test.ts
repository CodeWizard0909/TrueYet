import { describe, expect, it } from 'vitest';
import { breedForStep, crewStatus, stateForBreed, withStage, type StageEvent } from './director.ts';
import type { Breed } from './Mascot.tsx';

const play = (events: StageEvent[]) => events.reduce<Breed[]>(withStage, []);

const step = (id: string, status: 'running' | 'done' | 'failed') => ({ id, status });

describe('crewStatus: every dog involved in a question, and what it is doing', () => {
  it('shows Biscuit and Scout working at the same time while planning and the early search overlap', () => {
    expect(crewStatus([step('plan', 'running'), step('search-early', 'running')], { busy: true, hasText: false })).toEqual({
      biscuit: 'working',
      scout: 'working',
      bones: 'resting',
      watch: 'resting',
    });
  });

  it('a recheck question involves all four: done dogs stay done, Biscuit waits until it writes', () => {
    const steps = [
      step('plan', 'done'),
      step('memory', 'done'),
      step('recheck-0', 'done'),
      step('recheck-compare', 'running'),
      step('search-1', 'done'),
    ];
    expect(crewStatus(steps, { busy: true, hasText: false })).toEqual({
      biscuit: 'waiting',
      scout: 'done',
      bones: 'done',
      watch: 'working',
    });
  });

  it('Biscuit is working while it writes, and everyone is done when the turn ends', () => {
    const steps = [step('plan', 'done'), step('search-early', 'done')];
    expect(crewStatus(steps, { busy: true, hasText: true }).biscuit).toBe('working');
    expect(crewStatus(steps, { busy: false, hasText: true })).toEqual({ biscuit: 'done', scout: 'done', bones: 'resting', watch: 'resting' });
  });

  it('a stopped turn leaves nobody stuck on "working"', () => {
    expect(crewStatus([step('plan', 'done'), step('search-1', 'running')], { busy: false, hasText: false }).scout).toBe('done');
  });

  it('with no turn yet, the whole pack is resting', () => {
    expect(Object.values(crewStatus([], { busy: false, hasText: false }))).toEqual(['resting', 'resting', 'resting', 'resting']);
  });
});

describe('the pack hands off along the pipeline', () => {
  it('recheck turn: Biscuit plans, Bones digs, Watch rechecks, Biscuit writes', () => {
    expect(
      play([
        { type: 'step-start', id: 'plan' },
        { type: 'step-start', id: 'memory' },
        { type: 'step-start', id: 'recheck-0' },
        { type: 'step-start', id: 'recheck-1' },
        { type: 'step-start', id: 'recheck-compare' },
        { type: 'text' },
        { type: 'text' },
      ]),
    ).toEqual(['biscuit', 'bones', 'watch', 'biscuit']);
  });

  it('search turn: Scout takes over for searches, even ones that happen mid-answer', () => {
    expect(
      play([
        { type: 'step-start', id: 'plan' },
        { type: 'step-start', id: 'search-1' },
        { type: 'text' },
        { type: 'step-start', id: 'search-2' },
        { type: 'text' },
      ]),
    ).toEqual(['biscuit', 'scout', 'biscuit', 'scout', 'biscuit']);
  });

  it('plain chat stays with Biscuit', () => {
    expect(play([{ type: 'text' }, { type: 'text' }])).toEqual(['biscuit']);
  });

  it('ignores steps that belong to no dog', () => {
    expect(breedForStep('something-else')).toBeNull();
  });

  it('each dog has its own pose', () => {
    expect(stateForBreed('scout', false)).toBe('searching');
    expect(stateForBreed('bones', false)).toBe('remembering');
    expect(stateForBreed('biscuit', false)).toBe('thinking');
    expect(stateForBreed('biscuit', true)).toBe('answering');
  });
});
