// US03 - Magda Colunga: modelo temporal para Designer / Drag & Drop.
// Cambio realizado: se agregó almacenamiento en memoria para poder probar los endpoints sin depender todavía de una tabla nueva.
// Cuando el equipo defina el esquema de BD, este archivo debe cambiarse por consultas a Azure SQL.

const layoutDesignerStore = new Map();

const getCurrentDateIso = () => new Date().toISOString();
const createDesignerId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

const defaultDesignerLayout = {
  id: "layout dummy",
  name: "Modulo de hallazgos",
  elements: [
    {
      id: "titulo",
      type: "short-text",
      x: 24,
      y: 24,
      width: 280,
      height: 48,
      config: { label: "Titulo del hallazgo", required: true },
    },
    {
      id: "descripcion",
      type: "long-text",
      x: 24,
      y: 96,
      width: 420,
      height: 96,
      config: { label: "Descripcion", required: true },
    },
  ],
  createdAt: getCurrentDateIso(),
  updatedAt: getCurrentDateIso(),
};

layoutDesignerStore.set(defaultDesignerLayout.id, defaultDesignerLayout);

function copyDesignerLayout(designerLayout) {
  return {
    ...designerLayout,
    elements: designerLayout.elements.map(canvasElement => ({
      ...canvasElement,
      config: { ...canvasElement.config },
    })),
  };
}

export function listDesignerLayouts() {
  return Array.from(layoutDesignerStore.values()).map(copyDesignerLayout);
}

export function findDesignerLayout(layoutId) {
  const selectedDesignerLayout = layoutDesignerStore.get(layoutId);
  return selectedDesignerLayout ? copyDesignerLayout(selectedDesignerLayout) : null;
}

export function createDesignerLayout({ name, elements }) {
  const createdAt = getCurrentDateIso();
  const newDesignerLayout = {
    id: createDesignerId("layout"),
    name,
    elements: normalizeDesignerElements(elements),
    createdAt,
    updatedAt: createdAt,
  };

  layoutDesignerStore.set(newDesignerLayout.id, newDesignerLayout);
  return copyDesignerLayout(newDesignerLayout);
}

export function saveDesignerCanvas(layoutId, elements) {
  const selectedDesignerLayout = layoutDesignerStore.get(layoutId);
  if (!selectedDesignerLayout) return null;

  selectedDesignerLayout.elements = normalizeDesignerElements(elements);
  selectedDesignerLayout.updatedAt = getCurrentDateIso();

  return copyDesignerLayout(selectedDesignerLayout);
}

function normalizeDesignerElements(elements) {
  return elements.map(canvasElement => ({
    id: canvasElement.id || createDesignerId("element"),
    type: canvasElement.type,
    x: canvasElement.x,
    y: canvasElement.y,
    width: canvasElement.width,
    height: canvasElement.height,
    config: canvasElement.config || {},
  }));
}
