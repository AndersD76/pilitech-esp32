/* PILI TECH - campo de busca em todas as listas do portal (17/11/2026).
 *
 * Generico e sem tocar no carregamento dos dados: para cada alvo de window.PILI_BUSCA, poe um campo
 * de busca acima da lista e esconde os itens (cards ou linhas de tabela) cujo texto nao contem TODOS
 * os termos digitados (sem diferenciar maiusculas nem acentos). Quando a lista e redesenhada pela
 * atualizacao automatica, o filtro e reaplicado sozinho.
 *
 *   window.PILI_BUSCA = [
 *     { id: 'usuariosTableBody', ph: 'Buscar usuario...' },                 // <tbody>: filtra as linhas
 *     { id: 'empresasList', ph: 'Buscar empresa...' },                      // grade de cards: filtra os filhos
 *     { id: 'fwLista', itens: ':scope > table > tbody > tr' },              // tabela desenhada dentro do container
 *     { id: 'eventosLista', itens: ':scope > div > div' },                  // lista dentro de um embrulho
 *     { select: 'ctrlDeviceSelect', ph: 'Buscar dispositivo...' },          // <select>: filtra as opcoes
 *   ];
 */
(function () {
  'use strict';
  var norm = function (s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var LUPA = '<svg class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path stroke-linecap="round" d="M21 21l-4.3-4.3"/></svg>';

  function caixaDeBusca(ph, estreita) {
    var caixa = document.createElement('div');
    caixa.className = 'pili-busca flex items-center gap-2 ' + (estreita ? 'mb-1' : 'mb-3');
    caixa.innerHTML = '<div class="relative w-full ' + (estreita ? '' : 'sm:w-80') + '">' + LUPA +
      '<input type="search" autocomplete="off" spellcheck="false" class="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">' +
      '</div><span class="pili-busca-n text-xs text-gray-500 whitespace-nowrap"></span>';
    var inp = caixa.querySelector('input');
    inp.placeholder = ph || 'Buscar...';
    inp.setAttribute('aria-label', ph || 'Buscar');
    return { caixa: caixa, inp: inp, n: caixa.querySelector('.pili-busca-n') };
  }
  var termosDe = function (inp) { return norm(inp.value).split(/\s+/).filter(Boolean); };

  // ---------- listas (cards, linhas de tabela, itens) ----------
  function itensDe(c, cfg) {
    if (cfg.itens) return Array.prototype.slice.call(c.querySelectorAll(cfg.itens));
    if (c.tagName === 'TBODY') return Array.prototype.slice.call(c.rows);
    var tb = c.querySelector(':scope > table > tbody');
    if (tb) return Array.prototype.slice.call(tb.rows);
    return Array.prototype.slice.call(c.children);
  }
  // linha/elemento que so diz "Carregando", "Nenhum registro", "Selecione..." (nao e um item)
  function ehAviso(el, quantos) {
    if (el.tagName === 'TR') { var td = el.querySelector('td[colspan]'); return !!td && el.cells.length === 1; }
    if (el.tagName === 'P') return true;
    return quantos === 1 && el.children.length === 0;
  }
  function montarLista(cfg) {
    var c = document.getElementById(cfg.id);
    if (!c || c.getAttribute('data-pili-busca')) return;
    c.setAttribute('data-pili-busca', '1');
    var b = caixaDeBusca(cfg.ph);
    var ref = c;                                   // o campo fica logo acima da lista (ou da tabela dela)
    if (c.tagName === 'TBODY') ref = c.closest('.overflow-x-auto') || c.closest('table') || c;
    ref.parentNode.insertBefore(b.caixa, ref);
    var nada = document.createElement('p');
    nada.className = 'pili-busca-nada text-sm text-gray-400 py-3 hidden';
    b.caixa.parentNode.insertBefore(nada, b.caixa.nextSibling);
    function aplicar() {
      var termos = termosDe(b.inp), els = itensDe(c, cfg), vis = 0, total = 0;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (ehAviso(el, els.length)) { el.style.display = termos.length ? 'none' : ''; continue; }
        total++;
        var t = norm(el.textContent), ok = true;
        for (var k = 0; k < termos.length && ok; k++) if (t.indexOf(termos[k]) < 0) ok = false;
        el.style.display = ok ? '' : 'none';
        if (ok) vis++;
      }
      b.n.textContent = termos.length ? (vis + ' de ' + total) : '';
      var semResultado = termos.length > 0 && vis === 0;
      nada.textContent = semResultado ? 'Nada encontrado para "' + b.inp.value.trim() + '".' : '';
      nada.classList.toggle('hidden', !semResultado);
    }
    b.inp.addEventListener('input', aplicar);
    // a lista foi redesenhada (atualizacao automatica): reaplica o filtro que estiver digitado
    new MutationObserver(function () { if (b.inp.value) aplicar(); }).observe(c, { childList: true, subtree: true });
  }

  // ---------- <select> (lista de dispositivos, etc.) ----------
  function montarSelect(cfg) {
    var s = document.getElementById(cfg.select);
    if (!s || s.getAttribute('data-pili-busca')) return;
    s.setAttribute('data-pili-busca', '1');
    var b = caixaDeBusca(cfg.ph || 'Buscar na lista...', true);
    // campo + select num embrulho so deles: funciona igual dentro de linha flex, grade ou bloco
    var w = document.createElement('div');
    w.className = 'pili-busca-select flex flex-col ' + (cfg.classe || 'w-full sm:w-auto');
    s.parentNode.insertBefore(w, s);
    w.appendChild(b.caixa);
    w.appendChild(s);
    var todas = [], mexendo = false;
    function guardar() { todas = Array.prototype.map.call(s.options, function (o) { return { v: o.value, t: o.textContent, d: o.disabled }; }); }
    function aplicar() {
      var termos = termosDe(b.inp), atual = s.value, vis = 0, total = 0;
      mexendo = true;
      s.innerHTML = '';
      todas.forEach(function (o) {
        var item = o.v !== '';                     // a opcao vazia ("Selecione...") fica sempre
        if (item) total++;
        var t = norm(o.t), ok = true;
        for (var k = 0; k < termos.length && ok; k++) if (t.indexOf(termos[k]) < 0) ok = false;
        if (!item || ok || o.v === atual) {        // a opcao selecionada nunca some
          var op = document.createElement('option'); op.value = o.v; op.textContent = o.t; op.disabled = !!o.d; s.appendChild(op);
          if (item && ok) vis++;
        }
      });
      s.value = atual;
      b.n.textContent = termos.length ? (vis + ' de ' + total) : '';
      // deixa o observador ver (e ignorar) as mudancas que nos mesmos fizemos
      setTimeout(function () { mexendo = false; }, 0);
    }
    guardar();
    b.inp.addEventListener('input', aplicar);
    // a pagina recarregou as opcoes: guarda a lista nova e reaplica o filtro
    new MutationObserver(function () { if (mexendo) return; guardar(); if (b.inp.value) aplicar(); }).observe(s, { childList: true });
  }

  function iniciar() {
    (window.PILI_BUSCA || []).forEach(function (cfg) {
      try { if (cfg.select) montarSelect(cfg); else montarLista(cfg); } catch (e) { console.error('[busca]', cfg, e); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  window.piliBuscaIniciar = iniciar;     // para listas criadas depois do carregamento da pagina
})();
