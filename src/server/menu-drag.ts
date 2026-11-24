export type MenuMoveErrorCode =
  | 'INVALID_REQUEST'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_AMBIGUOUS'
  | 'CATEGORY_NOT_FOUND'
  | 'SUBCATEGORY_NOT_FOUND'
  | 'INCOMPATIBLE_DESTINATION'
  | 'DUPLICATE_ITEM'
  | 'NOOP';

export interface MenuMoveRequest {
  itemId: string;
  targetCategoryName: string;
  targetSubcategoryId?: string | null;
}

export interface MenuMoveLocation {
  categoryName: string;
  subcategoryId: string | null;
}

export interface MenuMoveSuccess {
  ok: true;
  changed: boolean;
  menu: any[];
  itemId: string;
  source: MenuMoveLocation;
  target: MenuMoveLocation;
}

export interface MenuMoveFailure {
  ok: false;
  code: MenuMoveErrorCode;
  message: string;
}

export type MenuMoveResult = MenuMoveSuccess | MenuMoveFailure;

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const sameId = (left: unknown, right: unknown): boolean => String(left ?? '') === String(right ?? '');
const categoryType = (category: any): string => text(category?.type).toLowerCase();
const isPizzaCatalog = (category: any): boolean => categoryType(category) === 'pizzas';
const categoryItems = (category: any): any[] => Array.isArray(category?.items) ? category.items : [];
const categorySubcategories = (category: any): any[] => Array.isArray(category?.subcategories) ? category.subcategories : [];
const subcategoryItems = (subcategory: any): any[] => Array.isArray(subcategory?.items) ? subcategory.items : [];

const invalidRequest = (message: string): MenuMoveFailure => ({
  ok: false,
  code: 'INVALID_REQUEST',
  message,
});

/**
 * Moves the authoritative item object to an existing category/subcategory.
 * The caller supplies the current server menu; no client catalog is accepted.
 * The original menu and item are not mutated, so a failed persistence attempt
 * can keep the previous tenant snapshot intact.
 */
export function moveMenuItem(menu: any[], request: Partial<MenuMoveRequest>): MenuMoveResult {
  if (!Array.isArray(menu)) return invalidRequest('Catálogo indisponível.');
  const itemId = text(request?.itemId);
  const targetCategoryName = text(request?.targetCategoryName);
  const targetSubcategoryId = request?.targetSubcategoryId == null
    ? null
    : text(request.targetSubcategoryId);
  if (!itemId || !targetCategoryName || (request?.targetSubcategoryId != null && !targetSubcategoryId)) {
    return invalidRequest('Produto e destino são obrigatórios.');
  }

  const itemLocations: Array<{ category: any; subcategory: any | null; item: any }> = [];
  for (const category of menu) {
    for (const item of categoryItems(category)) {
      if (sameId(item?.id, itemId)) itemLocations.push({ category, subcategory: null, item });
    }
    for (const subcategory of categorySubcategories(category)) {
      for (const item of subcategoryItems(subcategory)) {
        if (sameId(item?.id, itemId)) itemLocations.push({ category, subcategory, item });
      }
    }
  }
  if (itemLocations.length === 0) {
    return { ok: false, code: 'ITEM_NOT_FOUND', message: 'Produto não encontrado no catálogo oficial.' };
  }
  if (itemLocations.length > 1) {
    return { ok: false, code: 'ITEM_AMBIGUOUS', message: 'Produto duplicado no catálogo; movimento bloqueado para preservar sua identidade.' };
  }

  const source = itemLocations[0];
  const targetCategory = menu.find((category) => text(category?.name) === targetCategoryName);
  if (!targetCategory) {
    return { ok: false, code: 'CATEGORY_NOT_FOUND', message: 'Categoria de destino não encontrada.' };
  }
  const targetSubcategory = targetSubcategoryId == null
    ? null
    : categorySubcategories(targetCategory).find((subcategory) => sameId(subcategory?.id, targetSubcategoryId));
  if (targetSubcategoryId != null && !targetSubcategory) {
    return { ok: false, code: 'SUBCATEGORY_NOT_FOUND', message: 'Subcategoria de destino não encontrada nessa categoria.' };
  }

  // Pizza categories contain size/crust-specific entries. Moving one of those
  // entries into a normal catalog (or vice versa) would change how the waiter
  // interprets it, so reject instead of silently dropping that structure.
  if (isPizzaCatalog(source.category) !== isPizzaCatalog(targetCategory)) {
    return {
      ok: false,
      code: 'INCOMPATIBLE_DESTINATION',
      message: 'Destino incompatível: itens de Pizza só podem permanecer no catálogo de Pizza; nenhum campo foi alterado.',
    };
  }

  const sourceLocation: MenuMoveLocation = {
    categoryName: text(source.category.name),
    subcategoryId: source.subcategory ? text(source.subcategory.id) : null,
  };
  const targetLocation: MenuMoveLocation = {
    categoryName: text(targetCategory.name),
    subcategoryId: targetSubcategory ? text(targetSubcategory.id) : null,
  };
  if (sourceLocation.categoryName === targetLocation.categoryName &&
      sourceLocation.subcategoryId === targetLocation.subcategoryId) {
    return { ok: true, changed: false, menu, itemId, source: sourceLocation, target: targetLocation };
  }

  const targetItems = targetSubcategory ? subcategoryItems(targetSubcategory) : categoryItems(targetCategory);
  if (targetItems.some((item) => sameId(item?.id, itemId))) {
    return { ok: false, code: 'DUPLICATE_ITEM', message: 'O produto já existe no destino; movimento bloqueado para não duplicar o cadastro.' };
  }

  const nextMenu = menu.map((category) => {
    const isSourceCategory = category === source.category;
    const isTargetCategory = category === targetCategory;
    if (!isSourceCategory && !isTargetCategory) return category;

    let items = categoryItems(category);
    let subcategories = categorySubcategories(category);
    if (isSourceCategory) {
      if (source.subcategory) {
        subcategories = subcategories.map((subcategory) => subcategory === source.subcategory
          ? { ...subcategory, items: subcategoryItems(subcategory).filter((item) => !sameId(item?.id, itemId)) }
          : subcategory);
      } else {
        items = items.filter((item) => !sameId(item?.id, itemId));
      }
    }
    if (isTargetCategory) {
      if (targetSubcategory) {
        subcategories = subcategories.map((subcategory) => subcategory === targetSubcategory
          ? { ...subcategory, items: [...subcategoryItems(subcategory), source.item] }
          : subcategory);
      } else {
        items = [...items, source.item];
      }
    }
    return { ...category, items, subcategories };
  });

  return {
    ok: true,
    changed: true,
    menu: nextMenu,
    itemId,
    source: sourceLocation,
    target: targetLocation,
  };
}
