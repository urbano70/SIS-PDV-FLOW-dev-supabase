export const MENU_CATEGORIES = [
  {
    name: 'Pizzas com Borda',
    type: 'pizzas',
    items: [
      { id: 'pcb1', name: 'PIZZAS MINI COM BORDA', price: 58.00, ingredients: '2 sabores, 4 fatias' },
      { id: 'pcb2', name: 'PIZZAS MÉDIAS COM BORDA', price: 89.00, ingredients: '2 sabores, 8 fatias' },
      { id: 'pcb3', name: 'PIZZAS GG COM BORDA', price: 89.00, ingredients: '40 cm, 3 sabores, 12 fatias' },
      { id: 'pcb4', name: 'PIZZAS METRO COM BORDA', price: 38.00, ingredients: '20 x 1, 4 sabores, 24 fatias' },
    ]
  },
  {
    name: 'Pizzas sem Borda',
    type: 'pizzas',
    items: [
      { id: 'psb1', name: 'PIZZAS PEQUENAS SEM BORDA', price: 65.00, ingredients: '2 sabores, 6 fatias' },
      { id: 'psb2', name: 'PIZZAS GRANDES SEM BORDA', price: 95.00, ingredients: '35 cm, 3 sabores, 12 fatias' },
      { id: 'psb3', name: 'PIZZAS MEIO METRO SEM BORDA', price: 145.00, ingredients: '20 x 50, 3 sabores, 12 fatias' },
    ]
  },
  {
    name: 'Lanches',
    type: 'lanches',
    items: [
      { id: 'l1', name: 'X DELLI SALADA', price: 32.00, ingredients: 'Hambúrguer artesanal, alface, tomate, presunto, mussarela, milho verde, ervilha e molho Delli.' },
      { id: 'l2', name: 'X DELLI BACON', price: 40.00, ingredients: 'Hambúrguer artesanal, bacon, alface, tomate, mussarela, ovo, milho verde, ervilha e molho Delli.' },
      { id: 'l3', name: 'X DELLI BURGUER', price: 15.00, ingredients: 'Hambúrguer, tomate, ovo, mussarela, presunto e molho Delli.' },
    ]
  },
  {
    name: 'Bebidas',
    type: 'bebidas',
    items: [
      { id: 'b1', name: 'COCA COLA LATA', price: 14.00, ingredients: 'Lata' },
      { id: 'b2', name: 'FANTA LARANJA LATA', price: 10.00, ingredients: 'Lata' },
      { id: 'b3', name: 'GUARANÁ ANTARCTICA LATA', price: 6.00, ingredients: 'Lata' },
    ]
  }
];

export const PIZZA_FLAVORS = [
  { name: 'CALABRESA AO CREME', ingredients: 'Mussarela, molho de tomate, calabresa, creme de leite, orégano e azeitona.' },
  { name: 'CALABRESA COM CEBOLA', ingredients: 'Mussarela, molho de tomate, calabresa, cebola, orégano e azeitona.' },
  { name: 'CALABRESA', ingredients: 'Mussarela, molho de tomate, calabresa, orégano e azeitona.' },
  { name: 'QUATRO QUEIJOS', ingredients: 'Mussarela, molho de tomate, parmesão, provolone e catupiry.' },
  { name: 'BAIANA', ingredients: 'Mussarela, molho de tomate, calabresa, pimenta calabresa, orégano e azeitona.' },
  { name: 'STROGONOFF', ingredients: 'Mussarela, molho de alho, carne bovina, creme de leite, orégano e azeitona.' },
  { name: 'PICANHA AO CREME', ingredients: 'Mussarela, molho de alho, carne bovina, creme de leite, orégano e azeitona.' },
  { name: 'PICANHA COM CATUPIRY', ingredients: 'Mussarela, molho de tomate, carne bovina, catupiry, orégano e azeitona.' },
  { name: 'PICANHA', ingredients: 'Mussarela, molho de alho, carne bovina, cebola, orégano e azeitona.' },
  { name: 'CHOCOLATE', ingredients: 'Mussarela, chocolate ao leite, cereja e leite condensado.' },
  { name: 'PRESTIGIO', ingredients: 'Mussarela, chocolate ao leite, coco ralado, leite condensado.' },
  { name: 'CONFETE', ingredients: 'Mussarela, chocolate ao leite, confete, e leite condensado.' },
  { name: 'CHOCOLATE COM MORANGO', ingredients: 'Mussarela, chocolate ao leite, morango e leite condensado.' },
  { name: 'CHOCOLATE BRANCO', ingredients: 'Mussarela, chocolate branco, cereja e leite condensado.' },
  { name: 'BRIGADEIRO', ingredients: 'Mussarela, chocolate ao leite, granulado e leite condensado.' },
  { name: 'MARGUERITA', ingredients: 'Mussarela, molho de tomate, manjericão, tomate, orégano e azeitona.' },
  { name: 'BACON', ingredients: 'Mussarela, molho de tomate, bacon, orégano e azeitona.' },
  { name: 'RÚCULA COM TOMATE SECO', ingredients: 'Mussarela, molho de tomate, rúcula, tomate seco, orégano e azeitona.' },
  { name: 'ATUM COM CEBOLA', ingredients: 'Mussarela, molho de tomate, atum, cebola, orégano e azeitona.' },
  { name: 'MODA DA DELLI', ingredients: 'Mussarela, molho de tomate, ovo, milho, ervilha, cebola, bacon, tomate, orégano e azeitona.' },
  { name: 'PALMITO', ingredients: 'Mussarela, molho de tomate, palmito, orégano e azeitona.' },
  { name: 'BRÓCOLIS COM ALHO', ingredients: 'Mussarela, molho de tomate, brócolis, alho frito, orégano e azeitona.' },
  { name: 'BRÓCOLIS COM BACON', ingredients: 'Mussarela, molho de tomate, brócolis, bacon, orégano e azeitona.' },
  { name: 'BACON COM MILHO', ingredients: 'Mussarela, molho de tomate, bacon, milho, orégano e azeitona.' },
  { name: 'LOMBO', ingredients: 'Mussarela, molho de tomate, lombo canadense, orégano e azeitona.' },
  { name: 'LOMBO AO CREME', ingredients: 'Mussarela, molho de tomate, lombo canadense, creme de leite, orégano e azeitona.' },
  { name: 'CARNE DE SOL', ingredients: 'Mussarela, molho de tomate, carne desfiada, bacon, cebola, orégano e azeitona.' },
  { name: 'BEJINHO', ingredients: 'Mussarela, coco ralado,chocolate branco, e leite condensado.' },
  { name: 'PORTUGUESA', ingredients: 'Mussarela, molho de tomate, milho verde, ervilha, calabresa ralada, lombo ralado, ovo, orégano e azeitona.' },
  { name: 'ROMEU E JULIETA', ingredients: 'Mussarela, Goiabada, Creme de leite' },
];

export const PIZZA_CRUSTS = [
  "BORDA DE CHOCOLATE",
  "BRANCO",
  "CHEDDAR",
  "CATUPIRY"
];
