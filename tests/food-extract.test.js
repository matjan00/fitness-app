import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkUrl, classify, youtubeId, extractFromHtml, parseYouTube, parseTikTokOembed, parseTikTokHtml, decodeEntities, htmlToText,
  durationMin, isPrivateAddress, recipeLinks, fetchText, fetchRecipe, FetchError,
  looksLikeRecipe, cleanVtt, youtubeCaptionXmlToText, pickSubtitle, tiktokSubtitleList, youtubeCaptionTracks,
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

// ---------- subtitles / transcript fallback ----------

test('looksLikeRecipe: caption text with real quantities vs a bare hook line', () => {
  assert.equal(looksLikeRecipe('Kurczak po koreańsku: 200 g piersi z kurczaka, 2 łyżki sosu sojowego'), true);
  assert.equal(looksLikeRecipe('250 g ryżu i reszta w wideo'), false); // only one quantity
  assert.equal(looksLikeRecipe('GOTUJEMY'), false);
  assert.equal(looksLikeRecipe(''), false);
  assert.equal(looksLikeRecipe('Add 200 g of chicken and 2 tbsp of oil'), true);
});

// Trimmed, real WebVTT returned by a TikTok "pol-PL" ASR subtitle track (whisper-generated).
const TIKTOK_VTT = `WEBVTT

00:00:00.040 --> 00:00:03.000
Halinka jakie my dzisiaj przepyszne rzeczy gotujemy

00:00:14.400 --> 00:00:16.520
co my w ogóle robimy kurczaka Po koreańsku

00:00:29.280 --> 00:00:31.880
czyli basmati 13

00:00:31.881 --> 00:00:33.961
15min 1 torebka`;

test('cleanVtt strips timestamps/header and joins into prose', () => {
  const out = cleanVtt(TIKTOK_VTT);
  assert.equal(out, 'Halinka jakie my dzisiaj przepyszne rzeczy gotujemy co my w ogóle robimy kurczaka Po koreańsku czyli basmati 13 15min 1 torebka');
});

test('cleanVtt collapses rolling/cumulative caption lines', () => {
  const rolling = `WEBVTT

00:00:00.000 --> 00:00:01.000
Add two

00:00:01.000 --> 00:00:02.000
Add two cups

00:00:02.000 --> 00:00:03.000
Add two cups of flour`;
  assert.equal(cleanVtt(rolling), 'Add two cups of flour');
});

test('cleanVtt strips inline tags and cue numbers', () => {
  const withTags = `WEBVTT

1
00:00:00.000 --> 00:00:02.000 align:start position:0%
<c>Dodajemy</c> <00:00:00.500>sól i pieprz</c>`;
  assert.equal(cleanVtt(withTags), 'Dodajemy sól i pieprz');
});

test('youtubeCaptionXmlToText parses the default timedtext XML format', () => {
  const xml = '<transcript><text start="0" dur="2">Add two cups</text><text start="2" dur="2">Add two cups of flour &amp; salt</text></transcript>';
  assert.equal(youtubeCaptionXmlToText(xml), 'Add two cups of flour & salt');
});

// Trimmed shape of item.video.subtitleInfos as actually returned by a TikTok video page
// (script#__UNIVERSAL_DATA_FOR_REHYDRATION__ → …itemStruct.video.subtitleInfos).
test('tiktokSubtitleList reads real subtitleInfos shape and pickSubtitle prefers Polish', () => {
  const html = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' + JSON.stringify({
    __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { desc: 'GOTUJEMY', video: {
      subtitleInfos: [
        { LanguageID: '28', LanguageCodeName: 'pol-PL', Url: 'https://v16.tiktokcdn.com/pl.vtt', Format: 'webvtt', Version: '1:whisper_lid', Source: 'ASR' },
        { LanguageID: '1', LanguageCodeName: 'eng-US', Url: 'https://v16.tiktokcdn.com/en.vtt', Format: 'webvtt', Source: 'ASR' },
      ],
    } } } } },
  }) + '</script>';
  const list = tiktokSubtitleList(html);
  assert.equal(list.length, 2);
  const pick = pickSubtitle(list, (s) => s.LanguageCodeName, (s) => s.Source === 'ASR');
  assert.equal(pick.LanguageCodeName, 'pol-PL');
  assert.equal(pick.Url, 'https://v16.tiktokcdn.com/pl.vtt');
});

test('pickSubtitle falls back to English, then to whatever is first, and prefers non-ASR', () => {
  const enOnly = [{ LanguageCodeName: 'eng-US', Url: 'e' }, { LanguageCodeName: 'jpn-JP', Url: 'j' }];
  assert.equal(pickSubtitle(enOnly, (s) => s.LanguageCodeName).Url, 'e');
  const otherOnly = [{ LanguageCodeName: 'jpn-JP', Url: 'j' }, { LanguageCodeName: 'deu-DE', Url: 'd' }];
  assert.equal(pickSubtitle(otherOnly, (s) => s.LanguageCodeName).Url, 'j');
  assert.equal(pickSubtitle([], (s) => s.LanguageCodeName), null);
  const manualVsAsr = [{ languageCode: 'pl', kind: 'asr', baseUrl: 'a' }, { languageCode: 'pl', baseUrl: 'm' }];
  assert.equal(pickSubtitle(manualVsAsr, (t) => t.languageCode, (t) => t.kind === 'asr').baseUrl, 'm');
});

// Trimmed shape of captions.playerCaptionsTracklistRenderer.captionTracks as actually returned by a
// YouTube watch page's ytInitialPlayerResponse.
test('youtubeCaptionTracks reads real captionTracks shape from ytInitialPlayerResponse', () => {
  const html = 'var ytInitialPlayerResponse = ' + JSON.stringify({
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en', vssId: '.en', languageCode: 'en', name: { simpleText: 'English' } },
      { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&kind=asr', vssId: 'a.en', languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto)' } },
    ] } },
    videoDetails: { title: 'x' },
  }) + '; var x = 1;';
  const tracks = youtubeCaptionTracks(html);
  assert.equal(tracks.length, 2);
  const pick = pickSubtitle(tracks, (t) => t.languageCode, (t) => t.kind === 'asr');
  assert.equal(pick.vssId, '.en');
});

test('fetchRecipe: TikTok falls back to spoken subtitles when the caption has no recipe', async () => {
  const full = 'https://www.tiktok.com/@gloriankaaa/video/7486173288650034454';
  const html = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' + JSON.stringify({
    __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { desc: 'GOTUJEMY', author: { nickname: 'Glorianka' }, video: {
      cover: 'https://c/x.jpg',
      subtitleInfos: [{ LanguageID: '28', LanguageCodeName: 'pol-PL', Url: 'https://cdn.tiktok.com/sub.vtt', Format: 'webvtt', Source: 'ASR' }],
    } } } } },
  }) + '</script>';
  const f = fakeFetch({
    [`https://www.tiktok.com/oembed?url=${encodeURIComponent(full)}`]: { body: 'not json', type: 'application/json' },
    [full]: { body: html },
    'https://cdn.tiktok.com/sub.vtt': { body: TIKTOK_VTT, type: 'text/plain' },
  });
  const r = await fetchRecipe(full, { fetchImpl: f });
  assert.equal(r.text, 'GOTUJEMY');
  assert.equal(r.transcriptLang, 'pol-PL');
  assert.match(r.transcript, /kurczaka Po koreańsku/);
});

test('fetchRecipe: TikTok skips subtitles when the caption already has a recipe', async () => {
  const full = 'https://www.tiktok.com/@ewa/video/111';
  const f = fakeFetch({
    [`https://www.tiktok.com/oembed?url=${encodeURIComponent(full)}`]: { body: JSON.stringify({ title: 'Sushi: 250 g ryżu, 2 łyżki octu', author_name: 'Ewa', thumbnail_url: 'https://t/1.jpg' }), type: 'application/json' },
  });
  const r = await fetchRecipe(full, { fetchImpl: f });
  assert.equal(r.transcript, null);
  assert.equal(r.transcriptLang, null);
});
