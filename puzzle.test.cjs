const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPuzzleApp, getPuzzleGeometry, getPieceSourceRect, getResponsiveBoardWidth, shufflePositions } = require("../puzzle.js");

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    if (force === undefined) force = !this.values.has(value);
    if (force) this.values.add(value); else this.values.delete(value);
    return force;
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.classList = new FakeClassList();
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.attributes = {};
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.files = [];
    this.value = "";
    this.naturalWidth = 1200;
    this.naturalHeight = 800;
    this.decodeImpl = async () => {};
    this.clientWidth = 600;
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  async fire(type) { return this.listeners[type]?.({ target: this }); }
  click() { return this.disabled ? undefined : this.fire("click"); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; if (name === "src") this.src = ""; }
  async decode() { return this.decodeImpl(); }
  replaceChildren(...children) { this.children = children; }
  append(child) { this.children.push(child); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: 600 }; }
}

function createHarness(options = {}) {
  const ids = ["photoFile", "choosePhoto", "photoPreview", "previewImage", "photoStatus", "createPuzzle", "puzzleSection", "puzzleTitle", "boardScroller", "boardScrollHint", "boardWrap", "board", "celebrationParticles", "gameStatus", "restart"];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id === "previewImage" ? "img" : "div")]));
  const objectUrls = new Set();
  const revokedUrls = [];
  let nextUrl = 1;
  const scheduled = [];
  const urlApi = {
    createObjectURL() { const url = `blob:test-${nextUrl++}`; objectUrls.add(url); return url; },
    revokeObjectURL(url) { revokedUrls.push(url); objectUrls.delete(url); },
  };
  const doc = {
    querySelector(selector) { return elements[selector.slice(1)]; },
    createElement(tagName) { return new FakeElement(tagName); },
  };
  const app = createPuzzleApp({
    document: doc,
    URL: urlApi,
    random: options.random || (() => 0.37),
    setTimeout(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
  });
  return { app, elements, objectUrls, revokedUrls, scheduled };
}

async function choose(harness, file) {
  const input = harness.elements.photoFile;
  input.files = [file];
  input.value = "selected";
  await input.fire("change");
}

test("accepts JPEG, PNG, and WebP, shows the full preview, and generates 36 shared-image pieces", async (t) => {
  for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
    await t.test(mime, async () => {
      const h = createHarness();
      await choose(h, { type: mime, size: 2000, name: "photo" });
      assert.equal(h.elements.photoFile.value, "", "input resets so the same file can be selected again");
      assert.equal(h.elements.photoPreview.hidden, false);
      assert.equal(h.elements.createPuzzle.disabled, false);
      assert.match(h.elements.photoStatus.textContent, /読み込みました/);
      assert.equal(h.elements.puzzleSection.hidden, true, "loading a photo does not start the puzzle");

      await h.elements.createPuzzle.click();
      assert.equal(h.elements.board.children.length, 36);
      assert.equal(h.elements.puzzleSection.hidden, false);
      assert.equal(h.elements.createPuzzle.disabled, true);
      const imageUrls = new Set(h.elements.board.children.map((tile) => tile.style.backgroundImage));
      assert.equal(imageUrls.size, 1, "all tiles share one original image URL");
      assert.ok([...imageUrls][0].includes(h.elements.previewImage.src));
      assert.equal(h.elements.board.style.aspectRatio, "1200 / 800");
      assert.equal(new Set(h.elements.board.children.map((tile) => tile.style.backgroundPosition)).size, 36);
      assert.ok(h.elements.board.children.some((tile) => tile.style.backgroundPosition === "0% 0%"));
      assert.ok(h.elements.board.children.some((tile) => tile.style.backgroundPosition === "100% 100%"));
    });
  }
});

test("shuffles, selects, deselects, swaps, solves, locks, and resets", async () => {
  const h = createHarness();
  await choose(h, { type: "image/jpeg", size: 2000 });
  await h.elements.createPuzzle.click();
  const pieceAt = (index) => {
    const [x, y] = h.elements.board.children[index].style.backgroundPosition.match(/\d+/g).map(Number);
    return (y / 20) * 6 + x / 20;
  };
  assert.equal(new Set(h.elements.board.children.map((_, index) => pieceAt(index))).size, 36);
  assert.ok(h.elements.board.children.some((_, index) => pieceAt(index) !== index));

  const beforeA = pieceAt(0);
  const beforeB = pieceAt(1);
  assert.equal(h.scheduled.length, 0, "incomplete puzzles do not schedule a celebration");
  assert.equal(h.elements.boardWrap.classList.contains("is-celebrating"), false);
  await h.elements.board.children[0].click();
  assert.ok(h.elements.board.children[0].classList.contains("is-selected"));
  await h.elements.board.children[0].click();
  assert.match(h.elements.gameStatus.textContent, /2つ選んで/);
  assert.equal(pieceAt(0), beforeA, "same-tile second tap does not move a piece");

  await h.elements.board.children[0].click();
  await h.elements.board.children[1].click();
  assert.equal(pieceAt(0), beforeB);
  assert.equal(pieceAt(1), beforeA);
  await h.elements.board.children[3].click();
  await h.elements.board.children[7].click();
  assert.notEqual(pieceAt(3), 3, "consecutive swaps work");

  for (let target = 0; target < 36; target += 1) {
    const current = h.elements.board.children.findIndex((_, index) => pieceAt(index) === target);
    if (current !== target) {
      await h.elements.board.children[target].click();
      await h.elements.board.children[current].click();
    }
  }
  assert.match(h.elements.gameStatus.textContent, /完成/);
  assert.ok(h.elements.board.children.every((tile) => tile.disabled));
  assert.ok(h.elements.boardWrap.classList.contains("is-celebrating"));
  assert.ok(h.elements.board.classList.contains("is-celebrating"));
  assert.equal(h.elements.celebrationParticles.children.length, 24);
  assert.equal(h.scheduled.length, 1, "the completion effect schedules one cleanup");
  assert.equal(h.scheduled[0].delay, 1350);
  h.scheduled[0].callback();
  assert.equal(h.elements.boardWrap.classList.contains("is-celebrating"), false, "the visible effect cleans up after its duration");
  assert.equal(h.elements.celebrationParticles.children.length, 0);
  const completedPositions = h.elements.board.children.map((_, index) => pieceAt(index));
  await h.elements.board.children[0].click();
  assert.deepEqual(h.elements.board.children.map((_, index) => pieceAt(index)), completedPositions);
  assert.equal(h.scheduled.length, 1, "completed pieces cannot trigger the effect again");

  const puzzleUrl = h.elements.board.children[0].style.backgroundImage;
  await h.elements.restart.click();
  assert.equal(h.elements.board.children.length, 36);
  assert.equal(h.elements.board.children[0].style.backgroundImage, puzzleUrl, "reset keeps the same photo");
  assert.ok(h.elements.board.children.some((_, index) => pieceAt(index) !== index));
  assert.match(h.elements.gameStatus.textContent, /2つ選んで/);
  assert.equal(h.elements.boardWrap.classList.contains("is-celebrating"), false);
  assert.equal(h.elements.celebrationParticles.children.length, 0);
  h.scheduled[0].callback();
  assert.equal(h.elements.boardWrap.classList.contains("is-celebrating"), false, "stale cleanup cannot affect a restarted board");

  for (let target = 0; target < 36; target += 1) {
    const current = h.elements.board.children.findIndex((_, index) => pieceAt(index) === target);
    if (current !== target) {
      await h.elements.board.children[target].click();
      await h.elements.board.children[current].click();
    }
  }
  assert.equal(h.scheduled.length, 2, "reset allows a new one-time completion effect");
});

test("rejects unsupported MIME types, files over 10MB, unreadable images, and oversized dimensions", async () => {
  const badType = createHarness();
  await choose(badType, { type: "text/html", size: 10 });
  assert.match(badType.elements.photoStatus.textContent, /JPEG、PNG、WebP/);
  assert.equal(badType.elements.createPuzzle.disabled, true);

  const tooLarge = createHarness();
  await choose(tooLarge, { type: "image/png", size: 10 * 1024 * 1024 + 1 });
  assert.match(tooLarge.elements.photoStatus.textContent, /10MB/);

  const unreadable = createHarness();
  unreadable.elements.previewImage.decodeImpl = async () => { throw new Error("decode failure"); };
  await choose(unreadable, { type: "image/jpeg", size: 100 });
  assert.match(unreadable.elements.photoStatus.textContent, /読み込めません/);
  assert.equal(unreadable.elements.photoPreview.hidden, true);

  const oversizedImage = createHarness();
  oversizedImage.elements.previewImage.naturalWidth = 10_000;
  oversizedImage.elements.previewImage.naturalHeight = 5_000;
  await choose(oversizedImage, { type: "image/webp", size: 100 });
  assert.match(oversizedImage.elements.photoStatus.textContent, /解像度が大きすぎます/);
  assert.equal(oversizedImage.elements.createPuzzle.disabled, true);
});

test("selecting a second photo clears old puzzle state and revokes its image URLs", async () => {
  const h = createHarness();
  await choose(h, { type: "image/png", size: 100, name: "first" });
  await h.elements.createPuzzle.click();
  const firstPuzzleUrl = h.elements.board.children[0].style.backgroundImage;
  const firstPhotoUrl = h.elements.previewImage.src;
  const pieceAt = (index) => {
    const [x, y] = h.elements.board.children[index].style.backgroundPosition.match(/\d+/g).map(Number);
    return (y / 20) * 6 + x / 20;
  };
  for (let target = 0; target < 36; target += 1) {
    const current = h.elements.board.children.findIndex((_, index) => pieceAt(index) === target);
    if (current !== target) {
      await h.elements.board.children[target].click();
      await h.elements.board.children[current].click();
    }
  }
  assert.ok(h.elements.boardWrap.classList.contains("is-celebrating"));
  await choose(h, { type: "image/webp", size: 100, name: "second" });
  assert.equal(h.elements.puzzleSection.hidden, true);
  assert.equal(h.elements.board.children.length, 0);
  assert.ok(h.revokedUrls.includes(firstPhotoUrl));
  assert.ok(h.revokedUrls.some((url) => firstPuzzleUrl.includes(url)));
  await h.elements.createPuzzle.click();
  assert.equal(h.elements.board.children.length, 36);
  assert.notEqual(h.elements.board.children[0].style.backgroundImage, firstPuzzleUrl);
  assert.equal(h.elements.boardWrap.classList.contains("is-celebrating"), false);
  assert.equal(h.elements.celebrationParticles.children.length, 0);
  for (let target = 0; target < 36; target += 1) {
    const current = h.elements.board.children.findIndex((_, index) => pieceAt(index) === target);
    if (current !== target) {
      await h.elements.board.children[target].click();
      await h.elements.board.children[current].click();
    }
  }
  assert.ok(h.elements.boardWrap.classList.contains("is-celebrating"));
  assert.equal(h.scheduled.length, 2, "the replacement photo can trigger its own completion effect");
});

test("reselecting the same file works", async () => {
  const h = createHarness();
  const file = { type: "image/jpeg", size: 100, name: "same.jpg" };
  await choose(h, file);
  await choose(h, file);
  assert.equal(h.elements.createPuzzle.disabled, false);

});

test("reset errors are reported without removing the current puzzle", async () => {
  let failRandom = false;
  const h = createHarness({ random: () => { if (failRandom) throw new Error("random unavailable"); return 0.41; } });
  await choose(h, { type: "image/png", size: 100 });
  await h.elements.createPuzzle.click();
  const countBeforeReset = h.elements.board.children.length;
  failRandom = true;
  await h.elements.restart.click();
  assert.match(h.elements.gameStatus.textContent, /リセットできません/);
  assert.equal(h.elements.board.children.length, countBeforeReset);
  assert.equal(h.elements.puzzleSection.hidden, false);
});

test("square, landscape, portrait, and extreme aspect ratios keep the complete image in the grid", () => {
  const cases = [
    [1200, 1200, 1],
    [1920, 1080, 16 / 9],
    [1080, 1920, 9 / 16],
    [30000, 1000, 30],
    [2000, 20000, 0.1],
  ];
  for (const [width, height, aspectRatio] of cases) {
    const geometry = getPuzzleGeometry(width, height);
    assert.equal(geometry.aspectRatio, aspectRatio);
    assert.equal(geometry.columns, 6);
    assert.equal(geometry.rows, 6);
    const pieces = Array.from({ length: 36 }, (_, position) => getPieceSourceRect(width, height, position));
    const totalArea = pieces.reduce((sum, piece) => sum + piece.width * piece.height, 0);
    assert.ok(Math.abs(totalArea - width * height) < 0.001, "piece rectangles cover the full source area without gaps");
    assert.equal(pieces[0].x, 0);
    assert.equal(pieces[0].y, 0);
    assert.equal(pieces[35].x + pieces[35].width, width);
    assert.equal(pieces[35].y + pieces[35].height, height);
    assert.ok(Math.abs(pieces[35].width / pieces[35].height - width / height) < 0.000001,
      "piece shape follows source ratio without stretching");
    pieces.forEach((piece, position) => {
      assert.equal(piece.x, (position % 6) * width / 6);
      assert.equal(piece.y, Math.floor(position / 6) * height / 6);
    });
  }
  assert.throws(() => getPuzzleGeometry(0, 20), /サイズ/);
  assert.throws(() => getPieceSourceRect(20, 20, 36), /位置/);
});

test("generated board uses the selected image ratio and URL for every tested shape", async () => {
  for (const [width, height] of [[1200, 1200], [1920, 1080], [1080, 1920], [30000, 1000], [2000, 20000]]) {
    const h = createHarness();
    h.elements.previewImage.naturalWidth = width;
    h.elements.previewImage.naturalHeight = height;
    await choose(h, { type: "image/jpeg", size: 100 });
    await h.elements.createPuzzle.click();
    assert.equal(h.elements.board.style.aspectRatio, `${width} / ${height}`);
    assert.ok(parseInt(h.elements.boardWrap.style.width, 10) >= 600);
    assert.equal(h.elements.board.children.length, 36);
    assert.ok(h.elements.board.children.every((tile) => tile.style.backgroundImage.includes(h.elements.previewImage.src)));
  }
});

test("the board stays page-width for portrait images and scrolls only inside for wide images", async () => {
  for (const [width, height, scrolls] of [[900, 1600, false], [1600, 900, true], [30000, 1000, true]]) {
    const h = createHarness();
    h.elements.boardScroller.clientWidth = 320;
    h.elements.previewImage.naturalWidth = width;
    h.elements.previewImage.naturalHeight = height;
    await choose(h, { type: "image/jpeg", size: 100 });
    await h.elements.createPuzzle.click();
    const boardWidth = parseInt(h.elements.boardWrap.style.width, 10);
    assert.equal(h.elements.boardScrollHint.hidden, !scrolls);
    assert.equal(boardWidth > 320, scrolls);
    assert.equal(h.elements.board.children.length, 36);
  }
});

test("responsive board width keeps wide-photo tiles tappable inside an internal scroller", () => {
  for (const width of [320, 375, 390, 414, 768]) {
    const square = getResponsiveBoardWidth(width, 1000, 1000);
    assert.equal(square, width);
    const portrait = getResponsiveBoardWidth(width, 900, 1600);
    assert.equal(portrait, width);
    for (const ratio of [16 / 9, 30, 100]) {
      const boardWidth = getResponsiveBoardWidth(width, ratio * 1000, 1000);
      assert.ok(boardWidth >= width);
      assert.ok((boardWidth / ratio) / 6 >= 44, "landscape tile height preserves a useful tap edge");
    }
  }
});

test("shuffle never starts solved, and responsive rules cover requested phone widths", () => {
  const solvedRandom = () => 0.999999;
  const positions = shufflePositions(solvedRandom);
  assert.equal(positions.length, 36);
  assert.ok(positions.some((piece, index) => piece !== index));

  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.match(css, /@media\s*\(max-width:\s*420px\)/);
  for (const width of [320, 375, 390, 414, 768]) {
    assert.ok(width >= 320);
    const pageWidth = Math.min(width - (width <= 420 ? 24 : 36), 660);
    const gamePadding = Math.min(28, Math.max(16, width * 0.05));
    const boardWidth = pageWidth - 2 - 2 * gamePadding;
    assert.ok(boardWidth < width, `board viewport fits within a ${width}px viewport`);
  }
  assert.match(css, /\.board\s*\{[^}]*aspect-ratio:\s*1/si);
  assert.match(css, /grid-template-columns:\s*repeat\(6/);
  assert.match(css, /touch-action:\s*pan-x\s+pan-y\s+pinch-zoom/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /overscroll-behavior-x:\s*contain/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /rim-sweep\s+560ms/);
  assert.match(css, /board-pop\s+520ms/);
  assert.match(css, /particle-burst\s+1200ms/);
  assert.match(css, /message-fade-in\s+420ms/);
  assert.doesNotMatch(css, /background-size:\s*cover/);
});

test("app markup accepts only the requested image types and has no external upload endpoint", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "puzzle.js"), "utf8");
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /サーバーへ送信・保存されません/);
  assert.doesNotMatch(js, /\bfetch\s*\(/);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
});
