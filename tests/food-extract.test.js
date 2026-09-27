import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkUrl, classify, youtubeId, extractFromHtml, parseYouTube, parseTikTokOembed, parseTikTokHtml, decodeEntities, htmlToText,
  durationMin, isPrivateAddress, recipeLinks, fetchText, fetchRecipe, FetchError,
} from '../supabase/functions/fetch-recipe/extract.js';

test('URL safety checks', () => {
  assert.equal(checkUrl('https://aniagotuje.pl/przepis/leczo').hostname, 'aniagotuje.pl');
  for (const bad of ['ftp://x.com', 'http://localhost:5190', 'http://127.0.0.1/', 'http://10.0.0.5', 'http://192.168.1.1', 'http://[::1]/',
    'http://169.254.169.254/latest', 'http://printer.local/', 'javascript:alert(1)', 'not a url', 'http://user:pw@example.com', 'http://2130706433/']) {
    assert.throws(() => checkUrl(bad), FetchError, bad);
  }
  assert.equal(isPrivateAddress('172.20.1.1'), true);
  assert.equal(isPrivateAddress('172.32.1.1'), false);
  assert.equal(isPrivateAddress('fd00::1'), true);
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('classify and YouTube ids', () => {
  assert.equal(classify('https://vm.tiktok.com/ZMabc/'), 'tiktok');
  assert.equal(classify('https://www.tiktok.com/@x/video/1'), 'tiktok');
  assert.equal(classify('https://youtu.be/abc'), 'youtube');
  assert.equal(classify('https://m.youtube.com/watch?v=abc'), 'youtube');
  assert.equal(classify('https://www.instagram.com/reel/x'), 'instagram');
  assert.equal(classify('https://www.kwestiasmaku.com/przepis/x'), 'web');
  assert.equal(youtubeId('https://www.youtube.com/watch?v=15AQZfM1wX8&t=3'), '15AQZfM1wX8');
  assert.equal(youtubeId('https://youtube.com/shorts/38_iiWz5VFQ?si=abc'), '38_iiWz5VFQ');
  assert.equal(youtubeId('https://youtu.be/2rx1FGTRdkY'), '2rx1FGTRdkY');
});

test('entities and html to text', () => {
  assert.equal(decodeEntities('Ser &amp; szynka &#322;&#x105; &oacute;&nbsp;x'), 'Ser & szynka łą ó x');
  assert.equal(htmlToText('<p>A<br>B</p><ul><li>1</li><li>2</li></ul><script>x()</script>'), 'A\nB\n\n• 1\n\n• 2');
  assert.equal(durationMin('PT1H30M'), 90);
  assert.equal(durationMin('PT0H45M'), 45);
});

const LD = `<html><head><title>Leczo | Site</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
{"@type":["Recipe"],"name":"Leczo z kiełbasą &amp; papryką","image":[{"@type":"ImageObject","url":"https://img/x.jpg"}],
"author":{"@type":"Person","name":"Ania"},"recipeYield":["4","4 porcje"],"prepTime":"PT20M","cookTime":"PT45M",
"recipeIngredient":["3 papryki","<b>200 g</b> kiełbasy"],
"recipeInstructions":[{"@type":"HowToSection","name":"Warzywa","itemListElement":[{"@type":"HowToStep","text":"Pokrój paprykę."}]},{"@type":"HowToStep","text":"Duś 30 minut."}],
"nutrition":{"@type":"NutritionInformation","calories":"320 kcal","proteinContent":"15 g"}}]}</script></head><body></body></html>`;

test('JSON-LD recipe with @graph, sections and nutrition', () => {
  const r = extractFromHtml(LD, 'https://example.com/leczo');
  assert.equal(r.title, 'Leczo z kiełbasą & papryką');
  assert.equal(r.image, 'https://img/x.jpg');
  assert.equal(r.author, 'Ania');
  assert.deepEqual(r.jsonld.ingredients, ['3 papryki', '200 g kiełbasy']);
  assert.deepEqual(r.jsonld.steps, ['Warzywa:', 'Pokrój paprykę.', 'Duś 30 minut.']);
  assert.equal(r.jsonld.servings, 4);
  assert.equal(r.jsonld.prepMin, 20);
  assert.equal(r.jsonld.cookMin, 45);
  assert.deepEqual(r.jsonld.nutrition, { kcal: 320, protein: 15, carbs: null, fat: null, servingSize: null });
});

test('microdata fallback and og tags', () => {
  const html = `<html><head><meta property="og:title" content="Leczo | AniaGotuje.pl"><meta property="og:image" content="/img/l.jpg"></head><body>
    <h1 itemprop="name">Leczo</h1><meta itemprop="recipeYield" content="1750 gramów"><meta itemprop="prepTime" content="PT0H30M">
    <ul><li itemprop="recipeIngredient">3 cebule - 350 g</li><li itemprop="recipeIngredient">4 łyżki oleju</li></ul>
    <div itemprop="recipeInstructions"><div class="intro"><p>Intro.</p></div><h2>Przepis na leczo</h2><p>Pokrój cebulę i podsmaż ją na oleju przez pięć minut.</p><div><p>Dodaj paprykę i duś wszystko pod przykryciem przez pół godziny.</p></div></div>
    </body></html>`;
  const r = extractFromHtml(html, 'https://aniagotuje.pl/przepis/leczo');
  assert.equal(r.title, 'Leczo');
  assert.equal(r.image, 'https://aniagotuje.pl/img/l.jpg');
  assert.deepEqual(r.jsonld.ingredients, ['3 cebule - 350 g', '4 łyżki oleju']);
  assert.equal(r.jsonld.steps.length, 2);
  assert.equal(r.jsonld.servings, null);
  assert.equal(r.jsonld.prepMin, 30);
});

test('plain page: text starts at the real ingredients heading, not the menu', () => {
  const html = `<html><head><meta property="og:title" content="Puszyste naleśniki"></head><body><article>
    <ul><li>Składniki</li></ul><ul><li>Kasze</li><li>Ryż</li></ul>
    <h3>Składniki</h3><ul><li>2 szklanki mleka</li><li>3 jajka</li></ul><h3>Przygotowanie</h3><p>Zmiksuj.</p></article></body></html>`;
  const r = extractFromHtml(html, 'https://www.kwestiasmaku.com/przepis/nalesniki');
  assert.equal(r.jsonld, null);
  assert.equal(r.title, 'Puszyste naleśniki');
  assert.ok(r.text.startsWith('Składniki\n'));
  assert.ok(r.text.includes('• 2 szklanki mleka'));
  assert.ok(!r.text.includes('Kasze'));
});

test('YouTube player response parsing', () => {
  const html = `<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc123def45","title":"Makaron \\"szybki\\" {1}","shortDescription":"SKŁADNIKI:\\n200g makaronu\\nhttps://example.com/przepis","author":"Kucharz"}};var x=1;</script>`;
  const r = parseYouTube(html, 'https://www.youtube.com/watch?v=abc123def45');
  assert.equal(r.title, 'Makaron "szybki" {1}');
  assert.equal(r.text, 'SKŁADNIKI:\n200g makaronu\nhttps://example.com/przepis');
  assert.equal(r.author, 'Kucharz');
  assert.equal(r.image, 'https://i.ytimg.com/vi/abc123def45/hqdefault.jpg');
  assert.deepEqual(recipeLinks(r.text), ['https://example.com/przepis']);
  const generic = parseYouTube('<meta property="og:description" content="W YouTube możesz cieszyć się filmami">', 'https://youtu.be/abc123def45');
  assert.equal(generic.text, '');
});

test('TikTok oEmbed and page fallback', () => {
  assert.deepEqual(parseTikTokOembed({ title: 'Składniki: 2 jajka #fit', author_name: 'Ewa', thumbnail_url: 'https://t/x.jpg' }),
    { title: 'Składniki: 2 jajka #fit', author: 'Ewa', image: 'https://t/x.jpg' });
  const html = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"__DEFAULT_SCOPE__":{"webapp.video-detail":{"itemInfo":{"itemStruct":{"desc":"Owsianka 50 g płatków","author":{"nickname":"Ola"},"video":{"cover":"https://c/x.jpg"}}}}}}</script>';
  assert.deepEqual(parseTikTokHtml(html), { title: 'Owsianka 50 g płatków', author: 'Ola', image: 'https://c/x.jpg' });
});

// A fake fetch for the network flow: redirects are checked hop by hop.
function fakeFetch(routes) {
  return async (url, opts) => {
    const r = routes[url];
    if (!r) return new Response('nope', { status: 404 });
    if (r.redirect) return new Response(null, { status: 302, headers: { location: r.redirect } });
    assert.equal(opts.redirect, 'manual');
    return new Response(r.body, { status: 200, headers: { 'content-type': r.type || 'text/html; charset=utf-8' } });
  };
}

test('fetchText follows safe redirects, blocks unsafe ones, caps size', async () => {
  const f = fakeFetch({ 'https://a.com/x': { redirect: 'https://b.com/y' }, 'https://b.com/y': { body: 'ok' }, 'https://c.com/': { redirect: 'http://127.0.0.1/admin' }, 'https://big.com/': { body: 'x'.repeat(5000) } });
  const r = await fetchText('https://a.com/x', { fetchImpl: f });
  assert.equal(r.text, 'ok');
  assert.equal(r.url, 'https://b.com/y');
  await assert.rejects(fetchText('https://c.com/', { fetchImpl: f }), /not allowed/);
  await assert.rejects(fetchText('https://big.com/', { fetchImpl: f, maxBytes: 1000 }), /too big/);
  await assert.rejects(fetchText('https://a.com/x', { fetchImpl: f, hostCheck: async (h) => { if (h === 'b.com') throw new FetchError('That address is not allowed.'); } }), /not allowed/);
});

test('fetchRecipe: TikTok short link → oEmbed caption', async () => {
  const full = 'https://www.tiktok.com/@ewa/video/7496521530915048726';
  const f = fakeFetch({
    'https://vm.tiktok.com/ZMabc/': { redirect: `${full}?_r=1` },
    [`${full}?_r=1`]: { body: '<html></html>' },
    [`https://www.tiktok.com/oembed?url=${encodeURIComponent(full)}`]: { body: JSON.stringify({ title: 'Sushi  Składniki:  250 g ryżu', author_name: 'Ewa', thumbnail_url: 'https://t/1.jpg' }), type: 'application/json' },
  });
  const r = await fetchRecipe('https://vm.tiktok.com/ZMabc/', { fetchImpl: f });
  assert.equal(r.source, 'tiktok');
  assert.equal(r.url, full);
  assert.equal(r.text, 'Sushi  Składniki:  250 g ryżu');
  assert.equal(r.author, 'Ewa');
  await assert.rejects(fetchRecipe('https://www.instagram.com/reel/abc', { fetchImpl: f }), /Instagram/);
});
