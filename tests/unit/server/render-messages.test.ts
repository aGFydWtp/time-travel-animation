import { describe, expect, it } from 'vitest';
import { parseRenderMessage } from '../../../src/server/render-messages.ts';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('parseRenderMessage', () => {
  it('parses start and poll messages (job id lower-cased)', () => {
    expect(parseRenderMessage({ type: 'start', jobId: ID })).toEqual({ type: 'start', jobId: ID });
    expect(parseRenderMessage({ type: 'poll', jobId: ID.toUpperCase() })).toEqual({ type: 'poll', jobId: ID });
  });

  it('treats the legacy { jobId } message as start', () => {
    expect(parseRenderMessage({ jobId: ID })).toEqual({ type: 'start', jobId: ID });
  });

  it('rejects unknown types and malformed job ids (they end up in sandbox ids and paths)', () => {
    expect(parseRenderMessage({ type: 'upload', jobId: ID })).toBeNull();
    expect(parseRenderMessage({ type: 'start', jobId: '../../etc' })).toBeNull();
    expect(parseRenderMessage({ type: 'start', jobId: `${ID}; touch /tmp/pwned` })).toBeNull();
    expect(parseRenderMessage(null)).toBeNull();
    expect(parseRenderMessage('start')).toBeNull();
  });
});
