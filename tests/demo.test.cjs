const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
function setup() {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { url:'https://example.test/', runScripts:'outside-only' });
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  dom.window.confirm = () => true;
  dom.window.prompt = () => 'پیام ویرایش شد';
  dom.window.eval(readFileSync('app.js','utf8'));
  return dom;
}
test('send, edit and delete a message', () => {
  const d=setup(), doc=d.window.document;
  doc.querySelector('#messageInput').value='پیام آزمایشی';
  doc.querySelector('#messageForm').dispatchEvent(new d.window.Event('submit', {cancelable:true}));
  assert.match(doc.querySelector('#messages').textContent,/پیام آزمایشی/);
  const edits=doc.querySelectorAll('[data-edit]'); edits[edits.length-1].click();
  assert.match(doc.querySelector('#messages').textContent,/پیام ویرایش شد/);
  const deletes=doc.querySelectorAll('[data-delete]'); deletes[deletes.length-1].click();
  assert.doesNotMatch(doc.querySelector('#messages').textContent,/پیام ویرایش شد/);
  d.window.close();
});
test('bot creation, saved messages and theme', () => {
  const d=setup(), doc=d.window.document;
  doc.querySelector('#createBot').click();
  doc.querySelector('#modalName').value='ربات من';
  doc.querySelector('#modalReply').value='سلام!';
  doc.querySelector('#modalForm').dispatchEvent(new d.window.Event('submit', {cancelable:true}));
  assert.equal(doc.querySelector('#headerName').textContent,'ربات من');
  doc.querySelector('[data-nav="saved"]').click();
  assert.equal(doc.querySelector('#headerName').textContent,'پیام‌های ذخیره‌شده');
  doc.querySelector('#theme').click(); assert.ok(doc.body.classList.contains('dark'));
  d.window.close();
});
test('search filters conversations and output is escaped', () => {
  const d=setup(),doc=d.window.document;
  doc.querySelector('#search').value='سارا'; doc.querySelector('#search').dispatchEvent(new d.window.Event('input'));
  assert.equal(doc.querySelectorAll('.chat').length,1);
  doc.querySelector('#messageInput').value='<img src=x onerror=alert(1)>';
  doc.querySelector('#messageForm').dispatchEvent(new d.window.Event('submit', {cancelable:true}));
  assert.equal(doc.querySelector('#messages img'),null);
  d.window.close();
});
