/**
 * Tests for the exercise detail screen (B29, LIB-3): a library exercise opens to its name,
 * equipment, muscles worked (most direct first), all five imported coaching steps with their cue
 * text, and its tips — over the real bundled catalog; an unknown id shows the not-found state and
 * Back still works. The router is a stub; there is no network or database involved.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ALL_EXERCISES, exerciseById } from '@/library/catalog';
import { MUSCLE_NAMES, rankMuscles } from '@/library/muscles';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';

import ExerciseDetailScreen from '@/app/exercise/[id]';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { id?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

function renderDetail() {
  return render(
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <ExerciseDetailScreen />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
});

describe('exercise detail screen', () => {
  it('shows Bench Press with its equipment, ranked muscles, five steps and tips', async () => {
    mockParams = { id: 'bench_press' };
    const screen = await renderDetail();
    const bench = exerciseById('bench_press');
    if (!bench) throw new Error('catalog lost Bench Press');

    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('Barbell')).toBeTruthy();
    expect(screen.getByText('Muscles worked')).toBeTruthy();
    expect(screen.getByText('Chest, Shoulders, Triceps')).toBeTruthy();
    expect(screen.getByText('How to do it')).toBeTruthy();
    expect(bench.steps).toHaveLength(5);
    bench.steps.forEach((step, index) => {
      expect(screen.getByText(`${index + 1}. ${step.title}`)).toBeTruthy();
    });
    // The first cue's bold phrase is drawn as its own (bold) span, markers removed.
    expect(screen.getByText('Eyes under the bar')).toBeTruthy();
    expect(screen.queryByText(/\*\*/)).toBeNull();
    for (const tip of bench.tips) expect(screen.getByText(tip)).toBeTruthy();
  });

  it('every launch exercise opens with its muscles and all its steps (step DoD)', async () => {
    for (const exercise of ALL_EXERCISES) {
      mockParams = { id: exercise.id };
      const screen = await renderDetail();
      expect(screen.getByText(exercise.name)).toBeTruthy();
      expect(screen.getByText(rankMuscles(exercise.muscles).map((m) => MUSCLE_NAMES[m]).join(', '))).toBeTruthy();
      expect(exercise.steps.length).toBeGreaterThan(0);
      exercise.steps.forEach((step, index) => {
        expect(screen.getByText(`${index + 1}. ${step.title}`)).toBeTruthy();
      });
      await screen.unmount();
    }
  });

  it('an unknown id shows the not-found state, and Back leaves', async () => {
    mockParams = { id: 'not_an_exercise' };
    const screen = await renderDetail();
    expect(screen.getByText('That exercise isn’t in the library.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('Back falls through to the Library tab when there is nothing to go back to', async () => {
    mockParams = { id: 'bench_press' };
    mockRouter.canGoBack.mockReturnValue(false);
    const screen = await renderDetail();
    await fireEvent.press(screen.getByText('Back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/library');
  });
});
