import test from 'node:test';
import assert from 'node:assert/strict';
import { questionAnswers } from '../src/features/session/question-answers.ts';

test('user questions serialize free text and choices without sending empty answers', () => {
  const questions = [{ question: 'Why?' }, { question: 'Choice?' }];
  assert.deepEqual(questionAnswers(questions, { 'Why?': ['Some text'], 'Choice?': ['A', 'B'] }), { 'Why?': 'Some text', 'Choice?': 'A, B' });
  for (const picked of [{}, { 'Why?': [] }, { 'Why?': ['   '] }, { 'Why?': ['ok'], 'Choice?': [''] }])
    assert.equal(questionAnswers(questions, picked), undefined);
  assert.equal(questionAnswers([], {}), undefined);
  assert.equal(questionAnswers([{ question: 'constructor' }], {}), undefined);
});
