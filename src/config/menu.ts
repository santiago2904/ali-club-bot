export interface Product {
  id: string;
  name: string;
  priceCop: number;
  /** product_retailer_id in the WhatsApp catalog, when known. */
  retailerId?: string;
}

// Partial catalog: wing combos from the published menu image, the rest from
// WhatsApp catalog products the staff sent. Missing: sauces, drinks, add-ons.
// retailerIds were inferred from unique catalog prices; the rest need the catalog export.
// Meta requires a product thumbnail on catalog messages (Papa's club).
export const CATALOG_THUMBNAIL_RETAILER_ID = "grn0mye6y0";

const MENU: Product[] = [
  { id: "alitas_4", name: "Combo 4 alitas con papas a la francesa", priceCop: 10000, retailerId: "7qepppebuq" },
  { id: "alitas_8", name: "Combo 8 alitas con papas a la francesa", priceCop: 18000 },
  { id: "alitas_16", name: "Combo 16 alitas con papas a la francesa", priceCop: 34000 },
  { id: "alitas_20", name: "Combo 20 alitas con papas a la francesa", priceCop: 42000 },
  { id: "alitas_30", name: "Combo 30 alitas con papas a la francesa", priceCop: 62000 },
  { id: "hamburguesa_artesanal_sencilla", name: "Hamburguesa artesanal sencilla", priceCop: 15000 },
  { id: "hamburguesa_artesanal_doble", name: "Hamburguesa artesanal doble", priceCop: 21000 },
  { id: "hamburguesa_quesuda_sencilla", name: "Hamburguesa quesuda sencilla", priceCop: 15000 },
  { id: "hamburguesa_quesuda_doble", name: "Hamburguesa quesuda doble", priceCop: 21000 },
  { id: "papas_callejera", name: "Papa's callejera", priceCop: 19000 },
  { id: "papas_gourmet", name: "Papa's gourmet", priceCop: 21000 },
  { id: "papas_club", name: "Papa's club", priceCop: 25000, retailerId: "grn0mye6y0" },
  { id: "taco_paisa", name: "Taco paisa", priceCop: 14000 },
  { id: "taco_ranchero", name: "Taco ranchero", priceCop: 14000 },
  { id: "taco_mixto", name: "Taco mixto", priceCop: 15000 },
];

export function getMenu(): Product[] {
  return MENU;
}

export function findProduct(id: string): Product | undefined {
  return MENU.find((p) => p.id === id);
}

export function findProductByRetailerId(retailerId: string): Product | undefined {
  return MENU.find((p) => p.retailerId === retailerId);
}
