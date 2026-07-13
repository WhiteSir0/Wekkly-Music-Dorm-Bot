import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RegisteredUsers } from '../src/bot/registeredUsers.js';

test('테토봇 학번등록 파일에서 사용자 이름을 읽는다', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'registered-users-'));
  try {
    writeFileSync(join(directory, 'guild-a.json'), JSON.stringify({ 'user-a': '홍길동' }));

    const users = new RegisteredUsers(directory);

    assert.equal(await users.name('guild-a', 'user-a'), '홍길동');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('등록 파일이나 사용자가 없으면 이름을 반환하지 않는다', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'registered-users-empty-'));
  try {
    writeFileSync(join(directory, 'guild-a.json'), JSON.stringify({ 'other-user': '김철수' }));
    const users = new RegisteredUsers(directory);

    assert.equal(await users.name('guild-a', 'user-a'), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('이름 전용 파일에 다른 개인정보 구조가 들어오면 거절한다', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'registered-users-invalid-'));
  try {
    writeFileSync(join(directory, 'guild-a.json'), JSON.stringify({
      'user-a': { studentId: '70707', name: '홍길동', room: '707' },
    }));
    const users = new RegisteredUsers(directory);

    await assert.rejects(users.name('guild-a', 'user-a'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
