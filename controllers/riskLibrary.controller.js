
import {
  findRiskLibrary,
  findRiskLibraryById,
  findRiskLibraryRegisterDetails,
  findRiskLibraryRisks,
} from '../models/riskLibrary.model.js';

export async function getRiskLibraryController(req, res) {
  const { search = '', department = '' } = req.query;

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
      message: 'No se encontró el riesgo en la biblioteca.',
    });
  }

  res.json({ risk });
}

export async function getRiskLibraryRegisterDetailsController(req, res, next) {
  try {
    const { id } = req.params;

    const records = await findRiskLibraryRegisterDetails(id);

    if (!records.length) {
      return res.status(404).json({
        message: 'Risk Library entry not found.',
      });
    }

    return res.status(200).json({
      riskLibrary: {
        risk_library_id: records[0].risk_library_id,
        risk_name: records[0].risk_name,
        audit_department: records[0].audit_department,
      },
      records,
    });
  } catch (error) {
    next(error);
  }
}

export async function getRiskLibraryRisksController(req, res, next) {
  try {
    const risks = await findRiskLibraryRisks(req.params.id);

    return res.status(200).json({
      count: risks.length,
      risks,
    });
  } catch (error) {
    next(error);
  }
}
