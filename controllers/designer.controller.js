import {
  createDesignerLayout,
  findDesignerLayout,
  listDesignerLayouts,
  saveDesignerCanvas,
} from "../models/designer.model.js";

const allowedElementTypes = new Set(["short-text", "long-text", "catalog", "calculated", "date", "number", "section"]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateElement(element) {
  if (!element || typeof element !== "object" || Array.isArray(element)) {
    return "Cada elemento debe ser un objeto.";
  }

  if (!allowedElementTypes.has(element.type)) {
    return `Tipo de elemento no soportado: ${element.type}`;
  }

  if (!isFiniteNumber(element.x) || !isFiniteNumber(element.y)) {
    return "Cada elemento requiere coordenadas numéricas x/y.";
  }

  if (!isFiniteNumber(element.width) || !isFiniteNumber(element.height)) {
    return "Cada elemento requiere width/height numéricos.";
  }

  if (element.width <= 0 || element.height <= 0) {
    return "width y height deben ser mayores a 0.";
  }

  if (element.config !== undefined && (typeof element.config !== "object" || Array.isArray(element.config))) {
    return "config debe ser un objeto.";
  }

  return null;
}

function validateElements(elements) {
  if (!Array.isArray(elements)) return "elements debe ser un arreglo.";

  for (const element of elements) {
    const error = validateElement(element);
    if (error) return error;
  }

  return null;
}

// US03 - Magda Colunga: endpoint para listar módulos/layouts disponibles en el Designer.
export function getDesignerLayouts(req, res) {
  res.json({ layouts: listDesignerLayouts() });
}

// US03 - Magda Colunga: endpoint para cargar un layout con sus elementos del canvas.
export function getDesignerLayout(req, res) {
  const layout = findDesignerLayout(req.params.layoutId);
  if (!layout) return res.status(404).json({ message: "Layout no encontrado." });

  res.json({ layout });
}

// US03 - Magda Colunga: endpoint para crear un módulo visual configurable.
export function postDesignerLayout(req, res) {
  const { name, elements = [] } = req.body;

  if (!name || typeof name !== "string") {
    return res.status(400).json({ message: "name es requerido y debe ser texto." });
  }

  const elementsError = validateElements(elements);
  if (elementsError) return res.status(400).json({ message: elementsError });

  const layout = createDesignerLayout({ name, elements });
  res.status(201).json({ layout });
}

// US03 - Magda Colunga: endpoint para guardar posiciones/configuración después del drag & drop.
export function putDesignerCanvas(req, res) {
  const { elements } = req.body;

  const elementsError = validateElements(elements);
  if (elementsError) return res.status(400).json({ message: elementsError });

  const layout = saveDesignerCanvas(req.params.layoutId, elements);
  if (!layout) return res.status(404).json({ message: "Layout no encontrado." });

  res.json({ layout });
}

