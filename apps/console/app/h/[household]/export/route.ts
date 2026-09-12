import { NextResponse } from 'next/server';
import { ApiError, getExport } from '@/lib/recall';

/** The export downloads as a file rather than rendering: it is the person's own copy to keep. */
export async function GET(_request: Request, { params }: { params: Promise<{ household: string }> }) {
  const { household } = await params;
  try {
    const data = await getExport(household);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="recall-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Export failed' }, { status });
  }
}
