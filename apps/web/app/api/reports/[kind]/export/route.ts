import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { ValidationError } from "@/lib/errors";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { buildReport } from "@/lib/reports/service";
import { renderReportPdf } from "@/lib/reports/pdf";
import { renderReportXlsx } from "@/lib/reports/xlsx";
import { REPORT_KINDS, type ReportKind } from "@/lib/reports/types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ kind: string }>;
}

const CONTENT_TYPE: Record<"pdf" | "xlsx", string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Export a report as a downloadable PDF or Excel file. */
export async function GET(request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    const { kind } = await params;
    if (!(REPORT_KINDS as readonly string[]).includes(kind)) {
      throw new ValidationError("Unknown report type.");
    }
    const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "pdf";

    // PDF rendering uses pdf-lib's standard Latin fonts (CLAUDE.md §7 — Server Components /
    // performance-friendly, no external rendering service); those fonts cannot encode Arabic
    // glyphs, so the PDF is always rendered in English regardless of UI locale to avoid a
    // broken export. The on-screen preview and the Excel export are fully localized.
    const locale = format === "pdf" ? "en" : await getRequestLocale();
    const report = await buildReport(actor, kind as ReportKind, locale);
    const bytes =
      format === "pdf" ? await renderReportPdf(report) : await renderReportXlsx(report, locale);
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${kind}-report-${date}.${format}`;

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE[format],
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
