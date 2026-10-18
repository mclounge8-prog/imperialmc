import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDrinkCard } from './drinkCards.js';

test('premium drinks match the current cashier names', () => {
  const card = matchDrinkCard('Напиток Кокосовый берег', 'Премиум Напитки');
  assert.equal(card.id, 'coconut-shore');
  assert.equal(card.serveIn, 'Смузийник 350');
  assert.equal(matchDrinkCard('Напиток Яблочная жвачка', 'Премиум Напитки').serveIn, 'Коктейльная рюмка');
  assert.equal(matchDrinkCard('Напиток Белый тоник', 'Премиум Напитки').serveIn, 'Бокал для вина');
});

test('beer cocktails match, lemonade and milkshake pina colada do not', () => {
  assert.equal(matchDrinkCard('Пина-Колада', 'Коктейли на пиве').id, 'pina-beer');
  assert.equal(matchDrinkCard('Ягодный Фреш', 'Коктейли на пиве').id, 'berry-beer');
  assert.equal(matchDrinkCard('Клубника-Бум', 'Коктейли на пиве').id, 'strawberry-beer');
  assert.equal(matchDrinkCard('Лимонад Пина-колада', 'Лимонады'), null);
  assert.equal(matchDrinkCard('Пина колада', 'Милкшейки'), null);
  assert.equal(matchDrinkCard('Клубничная-жвачка', 'Лимонады'), null);
  assert.equal(matchDrinkCard('Напиток Клубничный рассвет', 'Премиум Напитки').id, 'strawberry-dawn');
});

test('sheet quantities stay on the matched card', () => {
  const mint = matchDrinkCard('Напиток Мятный лайм', 'Премиум Напитки');
  const sprite = mint.ingredients.find((row) => row.modifier === 'Спрайт');
  const mintLeaf = mint.ingredients.find((row) => row.modifier === 'Мята');
  assert.equal(sprite.qty, 80);
  assert.equal(mintLeaf.qty, 4);
  assert.equal(mint.serveIn, 'Хайболл 470');
});
