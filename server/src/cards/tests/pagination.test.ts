import { decodeCardCursor, encodeCardCursor } from '../utils/pagination.ts';

const CURSOR = {
  createdAt: '2026-07-20T10:30:00.000001Z',
  id: 'abcdef12-3456-4789-abcd-ef1234567890',
};

test.each([CURSOR.id, CURSOR.id.toUpperCase()])(
  'decodes cursor ID %s to lowercase without losing timestamp precision',
  id => {
    const encoded = encodeCardCursor({ ...CURSOR, id });

    expect(decodeCardCursor(encoded)).toEqual(CURSOR);
  },
);
