"""Independent arithmetic fixtures. Uses only Python's Fraction/Decimal libraries.

Run from the repository root. These expected values do not import application
code or query its database; both implementation layers are compared to them.
"""
import json
from fractions import Fraction as F
from decimal import Decimal, localcontext
from pathlib import Path

def text(q):
    if q is None:
        return None
    with localcontext() as c:
        c.prec = 48
        return format(Decimal(q.numerator) / Decimal(q.denominator), 'f')

def line(name, qty, unit, amount, pack, purchase_unit):
    return dict(name=name, quantity=qty, unit=unit,
                price=None if amount is None else dict(amount=amount, quantity=pack, unit=purchase_unit, currency='PHP'))

cheese = line('Cream cheese', '424', 'g', '750', '1.5', 'kg')
mixed = [cheese, line('Butter', '94', 'g', '60', '100', 'g'),
         line('Milk', '125', 'ml', '80', '1', 'l'),
         line('Vanilla', '0.25', 'g', '437.5', '1000', 'g')]
box = line('Outer box', '1', 'pc', '2000', '100', 'pc')
holders = line('Holders', '3', 'pc', '150', '100', 'pc')
basis = {'g': F(1), 'kg': F(1000), 'ml': F(1), 'l': F(1000), 'pc': F(1)}

def calc_line(row):
    p = row['price']
    return F(row['quantity']) * basis[row['unit']] / (F(p['quantity']) * basis[p['unit']]) * F(p['amount'])

def case(key, name, ingredients=None, packaging=None, other='0', factor='1', labor='0', selling='180', saleable='6', price_basis='unit', component=None):
    ingredients = ingredients if ingredients is not None else mixed
    packaging = packaging or []
    f, lu, count = F(factor), F(labor), F(saleable) * F(factor)
    complete = all(r['price'] is not None for r in ingredients + packaging)
    ingredient = sum((calc_line(r) for r in ingredients if r['price']), F(0)) * f
    package = sum((calc_line(r) for r in packaging if r['price']), F(0)) * f
    direct = F(other) * f
    if component:
        ingredient += F(component['cost']) * F(component['needed']) / F(component['yield']) * f
    base = ingredient + package + direct
    allowance = base * lu / 100
    adjusted = base + allowance
    revenue = F(selling) * (count if price_basis == 'unit' else f)
    profit = revenue - adjusted
    expected = dict(ingredient_cost=ingredient, packaging_cost=package, other_direct_cost=direct,
                    known_total=base, base_cost=base if complete else None,
                    labor_allowance=allowance if complete else None, adjusted_cost=adjusted if complete else None,
                    revenue=revenue, profit=profit if complete else None,
                    margin=profit / revenue * 100 if revenue and complete else None,
                    markup=profit / adjusted * 100 if adjusted and complete else None,
                    saleable_yield=count, unit_base=base / count if complete else None,
                    unit_adjusted=adjusted / count if complete else None,
                    unit_revenue=revenue / count, unit_profit=profit / count if complete else None)
    return dict(id=key, name=name, ingredients=ingredients, packaging=packaging, other_direct=other,
                factor=factor, component=component,
                costing=dict(mode='saleable', saleable_yield=saleable, labor_percent=labor,
                             selling_price=selling, price_basis=price_basis, sale_unit='each'),
                complete=complete, expected={k:text(v) for k,v in expected.items()})

cases = [case('A', 'Single ingredient', [cheese]),
         case('B', 'Mixed purchase sizes'),
         case('C', 'Ingredients, multiple packaging items and direct cost', packaging=[box, holders], other='5'),
         case('D', 'Pinned component portion', [cheese], [box], component=dict(cost='10', needed='50', **{'yield':'100'})),
         case('E', 'Half batch', packaging=[box, holders], other='5', factor='0.5'),
         case('F', '1.15 batch', packaging=[box, holders], other='5', factor='1.15'),
         case('G', 'Ten batches', packaging=[box, holders], other='5', factor='10'),
         case('H', 'Missing ingredient price', [cheese, line('Unpriced sugar','100','g',None,'1','kg')]),
         case('I', 'New supplier price', [line('Cream cheese','424','g','790','1.5','kg')]),
         case('J', 'Labor allowance zero', [line('Ingredient','100','g','100','100','g')], labor='0', saleable='1',selling='200'),
         case('K', 'Labor allowance ten percent', [line('Ingredient','100','g','100','100','g')], labor='10', saleable='1',selling='200'),
         case('L', 'Labor allowance twenty-five percent', [line('Ingredient','100','g','100','100','g')], labor='25', saleable='1',selling='200'),
         case('M', 'Selling below adjusted cost', [line('Ingredient','100','g','100','100','g')], labor='20', saleable='1',selling='100'),
         case('N', 'Break even', [line('Ingredient','100','g','100','100','g')], labor='20', saleable='1',selling='120'),
         case('O', 'Selling above adjusted cost', [line('Ingredient','100','g','100','100','g')], labor='20', saleable='1',selling='200'),
         case('P', 'Six saleable units', [line('Ingredient','600','g','100','100','g')], saleable='6',selling='180'),
         case('Q', 'Explicit batch selling price', [line('Ingredient','600','g','100','100','g')], saleable='6',selling='1080',price_basis='batch'),
         case('R', 'Zero selling price', [cheese], selling='0'),
         case('S', 'Confirmed zero cost', [line('Free ingredient','100','g','0','100','g')], saleable='1',selling='200')]
target = Path('tests/fixtures/recipe-cost-oracle.json')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(dict(source='Python fractions.Fraction; no application imports', cases=cases), indent=2)+'\n', encoding='utf-8')
print(f'Wrote {len(cases)} independent calculation cases to {target}')
