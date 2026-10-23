import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endsWithList } from '../lib/transcript.mjs';

const f = (n) => new URL(`./fixtures/${n}.jsonl`, import.meta.url).pathname;

test('felsorolással záruló válasz', () => assert.equal(endsWithList(f('list-end')), true));
test('felsorolás a válasz közepén', () => assert.equal(endsWithList(f('list-middle')), false));
test('egyelemű lista', () => assert.equal(endsWithList(f('list-single')), false));
test('hiányzó fájl', () => assert.equal(endsWithList('/nincs/ilyen.jsonl'), false));
test('félig írt utolsó sor', () => assert.equal(endsWithList(f('list-truncated')), true));
test('a lista az előző körhöz tartozik', () => assert.equal(endsWithList(f('list-before-prompt')), false));

test('kérdéssel bevezetett felsorolás nem teendőlista', () => assert.equal(endsWithList(f('list-question')), false));
test('kételemű lista nem elég', () => assert.equal(endsWithList(f('list-two')), false));
test('kérdésekből álló lista nem teendőlista', () => assert.equal(endsWithList(f('list-items-questions')), false));
