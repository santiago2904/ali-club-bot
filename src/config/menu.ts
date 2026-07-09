export interface Product {
  id: string;
  name: string;
  priceCop: number;
}

// Placeholder catalog — confirm real names/prices with the business before launch.
const MENU: Product[] = [
  { id: "wings_6", name: "6 alitas BBQ", priceCop: 18000 },
  { id: "wings_12", name: "12 alitas BBQ", priceCop: 32000 },
  { id: "wings_24", name: "24 alitas BBQ", priceCop: 60000 },
  { id: "fries", name: "Papas a la francesa", priceCop: 9000 },
  { id: "soda", name: "Gaseosa personal", priceCop: 4000 },
];

export function getMenu(): Product[] {
  return MENU;
}

export function findProduct(id: string): Product | undefined {
  return MENU.find((p) => p.id === id);
}
