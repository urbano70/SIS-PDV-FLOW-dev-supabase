# Amostra do relatório de caixa Bematech 80 mm

Gerada com `server-tests/fixtures/cash-register-report.fixture.json`; valores são fictícios e não representam uma conta real.

```text
                 RELATÓRIO DE CAIXA
Cx: Caixa 01
Abertura:                 23/11/2026 20:30
Fechamento:               23/11/2026 23:15
Fundo de Caixa:             R$ 100,00
================================================
=============== MEIOS DE PAGAMENTO =============
Meio                 Computado  Digitado Diferença
------------------------------------------------
Dinheiro                  20,00     19,00      1,00
Cartão                    27,00       N/D       N/D
------------------------------------------------
TOTAL RECEBIDO:            R$ 47,00
TOTAL A VISTA:             R$ 20,00
================= MOVIMENTAÇÕES =================
Abertura:                  R$ 100,00
Suprimento:                 R$ 50,00
Sangria:                    R$ 20,00
====================== VENDAS ===================
Produto                         Qtde          Total
------------------------------------------------
Pizza Grande com nome muito longo              28,13
longo para quebrar na largura     1
...
====================== CARTÕES ==================
Visa                         R$ 27,00
TOTAL CARTÕES:               R$ 27,00
====================== CLASSES ===================
Classe                           Qtde          Total
------------------------------------------------
Pizzas                              1          28,13
Bebidas                             2          16,88
TOTAL CLASSES:                R$ 45,00
======================= VALES ====================
Nome                            Data          Total
------------------------------------------------
Maria                     24/11/2026          12,00
TOTAL VALES:                 R$ 12,00
Usuário: N/D — usuário não informado
```

O fallback HTML usa a mesma sequência e marcação do documento ESC/POS, com largura CSS de 72 mm dentro do rolo de 80 mm. Campos ausentes aparecem como `N/D`; zero só aparece quando o resumo conhece a ausência de registros.
