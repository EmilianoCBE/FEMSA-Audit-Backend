import { getReport } from "../services/reports.service.js";

export async function getReportController(req, res) {
  res.json(await getReport(req.query, req.user));
}
