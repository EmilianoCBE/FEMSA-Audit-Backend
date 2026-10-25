import { findRiskLibrary, findRiskLibraryById } from "../models/riskLibrary.model.js";

export async function getRiskLibraryController(req, res) {
  const { search = "", department = "" } = req.query;

  const risks = await findRiskLibrary({
    search: String(search),
    department: String(department),
  });

  res.json({
    count: risks.length,
    risks,
  });
}

export async function getRiskLibraryByIdController(req, res) {
  const risk = await findRiskLibraryById(req.params.id);

  if (!risk) {
    return res.status(404).json({
      message: "No se encontró el riesgo en la biblioteca.",
    });
  }

  res.json({ risk });
}
