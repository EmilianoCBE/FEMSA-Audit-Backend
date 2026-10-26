import { HttpError } from "../utils/httpErrors.js";
import { findReportIdentity, findReportRows, REPORT_SOURCES } from "../repositories/reports.repository.js";

const common = [
  { id: "id", label: "Folio" },
  { id: "title", label: "Descripcion" },
  { id: "auditName", label: "Auditoria" },
  { id: "businessUnit", label: "Unidad de negocio" },
  { id: "status", label: "Estado" },
  { id: "severity", label: "Severidad" },
  { id: "responsible", label: "Responsable" },
];
export const REPORT_FIELDS = {
  audits: [
    ...common.filter((field) => !["auditName", "severity"].includes(field.id)),
    { id: "severity", label: "Prioridad" },
    { id: "date", label: "Fecha de inicio", type: "date" },
    { id: "endDate", label: "Fecha de fin", type: "date" },
  ],
  findings: [
    ...common,
    { id: "date", label: "Fecha de identificacion", type: "date" },
    { id: "amount", label: "Impacto MXN", type: "number" },
  ],
  plans: [
    ...common,
    { id: "date", label: "Fecha compromiso", type: "date" },
    { id: "endDate", label: "Fecha de conclusion", type: "date" },
    { id: "progress", label: "Avance %", type: "number" },
    { id: "lastProgress", label: "Ultimo avance", type: "date" },
    { id: "amount", label: "Monto MXN", type: "number" },
  ],
};
export function parseReportFilters(query) {
  const filters = {};
  const allowed = ["kind", "search", "businessUnit", "status", "severity", "start", "end"];
  if (Object.keys(query).some((key) => !allowed.includes(key))) throw new HttpError(400, "Filtro no permitido");
  for (const key of allowed) {
    const value = query[key] ?? (key === "kind" ? "findings" : "");
    if (typeof value !== "string" || value.length > (key === "search" ? 150 : 200))
      throw new HttpError(400, "Filtro no valido");
    filters[key] = value.trim();
  }
  if (!Object.hasOwn(REPORT_SOURCES, filters.kind)) throw new HttpError(400, "Tipo de reporte no permitido");
  for (const key of ["start", "end"]) {
    const value = filters[key];
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        value < "1753-01-01" ||
        value > "9998-12-31" ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw new HttpError(400, "Fecha no valida");
  }
  if (filters.start && filters.end && filters.start > filters.end)
    throw new HttpError(400, "La fecha inicial no puede ser mayor a la final");
  return filters;
}
const isClosed = (row) =>
  ["cerrado", "cerrada", "concluido", "concluida", "closed", "completado", "completada"].includes(
    String(row.status).toLowerCase(),
  );
export function reportIndicators(rows, kind, now) {
  const closed = rows.filter(isClosed).length;
  const items = [
    { id: "total", label: "Total de registros", value: rows.length, percent: false },
    { id: "open", label: "Registros abiertos", value: rows.length - closed, percent: false },
    {
      id: "closedPercent",
      label: "Porcentaje de cierre",
      value: rows.length ? (closed / rows.length) * 100 : 0,
      percent: true,
    },
  ];
  if (kind === "findings")
    items.push({
      id: "high",
      label: "Abiertos de severidad alta o critica",
      value: rows.filter(
        (row) =>
          !isClosed(row) &&
          ["alta", "critica", "crítica", "high", "critical"].includes(String(row.severity).toLowerCase()),
      ).length,
      percent: false,
    });
  if (kind === "plans") {
    items.push({
      id: "overdue",
      label: "Planes vencidos sin concluir",
      value: rows.filter((row) => !isClosed(row) && !row.endDate && row.date && new Date(row.date) < now).length,
      percent: false,
    });
    const progress = rows.filter((row) => row.progress !== null);
    items.push({
      id: "averageProgress",
      label: "Avance promedio",
      value: progress.length ? progress.reduce((sum, row) => sum + Number(row.progress), 0) / progress.length : 0,
      percent: true,
    });
  }
  return items;
}

// La sesion se resuelve contra el usuario real y no contra un id que mande el navegador
export async function getReport(query, user, repository = { findReportIdentity, findReportRows }, now = new Date()) {
  const filters = parseReportFilters(query);
  const identity = await repository.findReportIdentity(user.id);
  if (!identity) throw new HttpError(403, "Tu usuario no tiene acceso a los reportes");
  const raw = await repository.findReportRows(filters.kind, filters, identity);
  if (raw.length > 10000) throw new HttpError(422, "Hay mas de 10000 registros Reduce el periodo o agrega filtros");
  const fields = REPORT_FIELDS[filters.kind];
  const rows = raw.map((row) =>
    Object.fromEntries([
      ["recordId", row.recordId],
      ...fields.map((field) => {
        let value = row[field.id] ?? null;
        if (value !== null && field.type === "date") value = new Date(value).toISOString();
        if (value !== null && field.type === "number") value = Number(value);
        return [field.id, value];
      }),
    ]),
  );
  return {
    kind: filters.kind,
    fields,
    rows,
    filters,
    indicators: reportIndicators(rows, filters.kind, now),
    queriedAt: now.toISOString(),
    source: `E12_FEMSA | ${REPORT_SOURCES[filters.kind].tables.join(" + ")}`,
    scope: identity.allRecords
      ? "Todas las auditorias"
      : "Auditorias propias o donde participas y registros a tu cargo",
  };
}
