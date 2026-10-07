/* Inventario de casa — lógica compartida (la usa la app y también Google Sheets).
   Entiende las frases del chat y aplica los cambios al inventario. */
var Core = (function () {
  'use strict';

  function sa(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

  var NUM = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
    nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16,
    diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30, cuarenta: 40,
    cincuenta: 50, cien: 100, medio: 0.5, media: 0.5 };

  var UNI = {};
  (function () {
    var defs = {
      kg: 'kg kgs kilo kilos kilogramo kilogramos', g: 'g gr grs gramo gramos',
      l: 'l lt lts litro litros', ml: 'ml cc mililitro mililitros',
      paquete: 'paquete paquetes paq', lata: 'lata latas', botella: 'botella botellas',
      caja: 'caja cajas', bolsa: 'bolsa bolsas', frasco: 'frasco frascos',
      sachet: 'sachet sachets', rollo: 'rollo rollos', pote: 'pote potes', atado: 'atado atados',
      bandeja: 'bandeja bandejas', sobre: 'sobre sobres', barra: 'barra barras',
      tarro: 'tarro tarros', pack: 'pack packs', bidon: 'bidon bidones', maple: 'maple maples',
      tableta: 'tableta tabletas', unidad: 'unidad unidades u'
    };
    for (var k in defs) defs[k].split(' ').forEach(function (w) { UNI[w] = k; });
  })();
  var MEDIDAS = { kg: 1, g: 1, l: 1, ml: 1 };
  var CONV = { 'kg>g': 1000, 'g>kg': 0.001, 'l>ml': 1000, 'ml>l': 0.001 };

  var ENT = lista('compre compramos compro compraron traje trajimos trajo trajeron agregue agrego agrega agregar agregamos sume sumar suma sumamos guarde guardamos guardar puse pusimos entro entraron entra ingreso ingrese llego llegaron repuse repusimos +');
  var SAL = lista('saque sacamos saco sacar saca sacaron use usamos uso usar usaron gaste gastamos gasto consumi consumimos consumio retire retiramos retiro retirar comi comimos comio tome tomamos tomo abri abrimos abrio lleve llevamos llevo -');
  var ARTIC = lista('de del el la los las unos unas otro otra otros otras');
  var LUGAR = lista('almacen alacena despensa deposito heladera freezer cocina garage lavadero baulera mueble casa');
  var TIEMPO = lista('hoy ayer recien anoche');
  var STOPQ = lista('hay queda quedan tenemos tengo nos de del el la los las en casa almacen alacena despensa todavia aun');

  function lista(s) { var o = {}; s.split(' ').forEach(function (w) { o[w] = 1; }); return o; }

  /* Clave para reconocer el mismo producto aunque se escriba distinto (tomate / Tomates / tomaté). */
  function clave(nombre) {
    return sa(String(nombre).toLowerCase()).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map(function (w) {
      if (w.length > 3 && /s$/.test(w)) w = w.slice(0, -1);
      if (w.length > 3 && /[lrndzj]e$/.test(w)) w = w.slice(0, -1);
      return w;
    }).join(' ');
  }

  function red(n) { return Math.round(n * 1000) / 1000; }
  function fmt(n) { return String(red(n)).replace('.', ','); }
  function plural(u) { return u === 'sachet' || u === 'pack' ? u + 's' : /[aeiou]$/.test(u) ? u + 's' : u + 'es'; }
  function cantTxt(q, u) {
    u = u || 'unidad';
    if (MEDIDAS[u]) return fmt(q) + ' ' + u;
    return fmt(q) + ' ' + (red(q) === 1 ? u : plural(u));
  }
  function cant(q, u) { return !u || u === 'unidad' ? fmt(q) : cantTxt(q, u); }
  function mayus(s) { s = String(s).trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- Fechas de vencimiento (se guardan como AAAA-MM-DD) ---------- */

  var MESES = { ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
    jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, set: 9, sept: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10,
    nov: 11, noviembre: 11, dic: 12, diciembre: 12 };
  var VENC = lista('vence vencen vto venc vencimiento vencia vencian caduca');
  var HOY = '';
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function hoyLocal() { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function iso(y, m, d) {
    y = +y; m = +m; d = +d;
    if (y < 100) y += 2000;
    if (!(m >= 1 && m <= 12) || y < 2000 || y > 2100) return null;
    var ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d === 0) d = ult;                       // solo mes y año: último día del mes
    if (!(d >= 1 && d <= ult)) return null;
    return y + '-' + p2(m) + '-' + p2(d);
  }
  /* Acepta 15/03/2027, 15/3/27, 15-03-2027, 03/2027, 03/27, 15/03, "15 de marzo de 2027", "marzo 2027". */
  function parseFecha(s, hoy) {
    s = sa(String(s || '').toLowerCase()).replace(/\b(el|del|de|dia|en|es|hasta|fin|fines)\b/g, ' ').replace(/[,:]/g, ' ').replace(/\s+/g, ' ').trim();
    hoy = hoy || hoyLocal();
    var anio = +hoy.slice(0, 4), m;
    function prox(mes, dia) { var f = iso(anio, mes, dia); if (f && f < hoy) f = iso(anio + 1, mes, dia); return f; }
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return iso(m[1], m[2], m[3]);
    if ((m = /^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2}|\d{4})$/.exec(s))) return iso(m[3], m[2], m[1]);
    if ((m = /^(\d{1,2})[\/\-. ](\d{4})$/.exec(s))) return iso(m[2], m[1], 0);
    if ((m = /^(\d{1,2})[\/\-.](\d{1,2})$/.exec(s))) {
      if (+m[2] > 12 && +m[1] <= 12) return iso(m[2], m[1], 0);   // 03/27 = marzo de 2027
      return prox(m[2], m[1]);                                      // 15/03 = 15 de marzo
    }
    if ((m = /^(\d{1,2}) ([a-z]+)(?: (\d{2}|\d{4}))?$/.exec(s)) && MESES[m[2]]) return m[3] ? iso(m[3], MESES[m[2]], m[1]) : prox(MESES[m[2]], m[1]);
    if ((m = /^([a-z]+)(?: (\d{2}|\d{4}))?$/.exec(s)) && MESES[m[1]]) return m[2] ? iso(m[2], MESES[m[1]], 0) : prox(MESES[m[1]], 0);
    return null;
  }
  function fmtFecha(v) { return v ? v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4) : ''; }
  function dias(v, hoy) { return Math.round((Date.parse(v + 'T00:00:00Z') - Date.parse((hoy || hoyLocal()) + 'T00:00:00Z')) / 86400000); }
  /* '' si falta mucho; si no "vencido", "vence hoy", "vence en 5 días". */
  function aviso(v, hoy) {
    if (!v) return '';
    var d = dias(v, hoy);
    if (d < 0) return 'vencido';
    if (d === 0) return 'vence hoy';
    if (d <= 30) return 'vence en ' + d + (d === 1 ? ' día' : ' días');
    return '';
  }

  /* ---------- Entender el mensaje ---------- */

  function tokens(texto) {
    var t = String(texto).toLowerCase().trim()
      .replace(/(\d),(\d)/g, '$1.$2')
      .replace(/[¿?¡!;:()"']/g, ' ')
      .replace(/\.(?!\d)/g, ' ')
      .replace(/,/g, ' , ')
      .replace(/\+/g, ' + ')
      .replace(/(^|\s)-\s*(?=\d)/g, ' - ');
    return t.split(/\s+/).filter(Boolean).map(function (o) { return { o: o, n: sa(o) }; });
  }

  function leerNum(tok, soloDigitos) {
    if (!tok) return null;
    var m = /^x?(\d+(?:\.\d+)?)([a-z]+)?$/.exec(tok.n);
    if (m) {
      if (m[2] && !UNI[m[2]]) return null;
      return { q: parseFloat(m[1]), u: m[2] ? UNI[m[2]] : null };
    }
    m = /^(\d+)\/(\d+)$/.exec(tok.n);
    if (m && +m[2]) return { q: m[1] / m[2], u: null };
    if (!soloDigitos && NUM.hasOwnProperty(tok.n)) return { q: NUM[tok.n], u: null };
    return null;
  }
  function esCant(tok) { return !!leerNum(tok) || (tok && /^docenas?$/.test(tok.n)); }

  function separar(toks) {
    var items = [], cur = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], sig = toks[i + 1], sig2 = toks[i + 2];
      var yMedio = t.n === 'y' && sig && (sig.n === 'medio' || sig.n === 'media') && !(sig2 && /^docenas?$/.test(sig2.n)) && cur.some(function (x) { return leerNum(x); });
      var sigueVenc = t.n === ',' && sig && /^(no|sin|que|con|vence|vencen|vto)$/.test(sig.n) && toks.slice(i + 1, i + 5).some(function (x) { return VENC[x.n]; });
      if (sigueVenc) continue;
      if (t.n === ',' || (t.n === 'y' && !yMedio)) { if (cur.length) items.push(cur); cur = []; }
      else cur.push(t);
    }
    if (cur.length) items.push(cur);
    return items;
  }

  function leerItem(toks) {
    toks = toks.slice();
    while (toks.length && ARTIC[toks[0].n]) toks.shift();
    var venc;   // undefined = no lo dijo, '' = dijo que no vence
    for (var v = 0; v < toks.length; v++) {
      if (!VENC[toks[v].n]) continue;
      var ini = v, neg = false;
      while (ini > 0 && /^(que|con|sin|no|fecha|de|y|tiene|tienen)$/.test(toks[ini - 1].n)) { ini--; if (/^(sin|no)$/.test(toks[ini].n)) neg = true; }
      var fe = parseFecha(toks.slice(v + 1).map(function (x) { return x.o; }).join(' '), HOY);
      if (fe) venc = fe; else if (neg) venc = '';
      toks = toks.slice(0, ini);
      break;
    }
    if (!toks.length) return null;
    var q = null, u = null, i = 0, tokUni = null, implicita = false;
    var n0 = leerNum(toks[0]);
    if (n0) {
      q = n0.q; u = n0.u; i = 1;
      if (toks[i] && /^docenas?$/.test(toks[i].n)) { q *= 12; i++; }
      else if (!u && toks[i] && UNI[toks[i].n]) { u = UNI[toks[i].n]; tokUni = toks[i]; i++; }
      if (toks[i] && toks[i].n === 'y' && toks[i + 1] && /^medi[oa]$/.test(toks[i + 1].n)) { q += 0.5; i += 2; }
      if (toks[i] && (toks[i].n === 'de' || toks[i].n === 'del')) i++;
    } else if (/^docenas?$/.test(toks[0].n)) {
      q = 12; i = 1;
      if (toks[i] && toks[i].n === 'de') i++;
    }
    var p = toks.slice(i);
    if (q === null) {
      var L = p.length, nf = leerNum(p[L - 1], true);
      if (L >= 2 && nf) { q = nf.q; u = nf.u; p.pop(); }
      else if (L >= 3 && UNI[p[L - 1].n] && leerNum(p[L - 2], true)) { u = UNI[p[L - 1].n]; q = leerNum(p[L - 2], true).q; p.pop(); p.pop(); }
      else { q = 1; implicita = true; }
      while (p.length && /^(x|a|de|por)$/.test(p[p.length - 1].n)) p.pop();
    }
    // cortar "del almacén", "de la alacena", "hoy", etc.
    for (var j = 0; j < p.length; j++) {
      var a = p[j].n, b = p[j + 1] && p[j + 1].n, c = p[j + 2] && p[j + 2].n;
      if (TIEMPO[a] || ((a === 'del' || a === 'al') && LUGAR[b]) ||
          ((a === 'de' || a === 'en' || a === 'a') && (b === 'la' || b === 'el') && LUGAR[c])) { p = p.slice(0, j); break; }
    }
    while (p.length && ARTIC[p[0].n]) p.shift();
    while (p.length && /^(de|y|mas)$/.test(p[p.length - 1].n)) p.pop();
    if (!p.length) {
      if (!tokUni) return null;
      p = [tokUni]; u = null;
    }
    if (!(q >= 0) || q > 100000) return null;
    var it = { producto: mayus(p.map(function (x) { return x.o; }).join(' ')), cantidad: red(q), unidad: u, implicita: implicita };
    if (venc !== undefined) it.venc = venc;
    return it;
  }

  function leerItems(toks, tipo) {
    var out = [];
    separar(toks).forEach(function (g) {
      var it = leerItem(g);
      if (it) { it.tipo = tipo; out.push(it); }
    });
    return out;
  }

  function quitarPrefijo(toks, nt, resto) { return toks.slice(toks.length - resto.split(' ').length); }

  /* Devuelve { tipo: 'mov'|'duda'|'consulta'|'lista'|'faltantes'|'deshacer'|'ayuda'|'nose', items, producto } */
  function entender(texto, hoy) {
    HOY = hoy || hoyLocal();
    var toks = tokens(texto);
    var nt = toks.map(function (t) { return t.n; }).join(' ');
    var m;
    if (!toks.length) return { tipo: 'nose' };
    if (/^(ayuda|help|como (se usa|funciona|hago))/.test(nt)) return { tipo: 'ayuda' };
    if (/^(deshacer|deshace|borra(r)? (lo )?ultimo|me equivoque|anular|cancelar)\b/.test(nt)) return { tipo: 'deshacer' };
    if (/^(lista|inventario|ver (todo|inventario|la lista|lista)|mostrar (todo|inventario)|que (hay|tenemos|queda))$/.test(nt)) return { tipo: 'lista' };
    if (/^(que (vence|vencio|se vence|se vencio|esta (por vencer|vencido)|hay (por vencer|vencido))|vencimientos?|por vencer|vencidos)/.test(nt)) return { tipo: 'vencen' };
    if (/^(que (falta|se termino|hay que comprar|no hay)|faltantes|lista de compras)/.test(nt)) return { tipo: 'faltantes' };

    if ((m = /^(?:borrar|eliminar|quitar del inventario) (.+)$/.exec(nt))) {
      var pb = quitarPrefijo(toks, nt, m[1]);
      while (pb.length && ARTIC[pb[0].n]) pb.shift();
      if (pb.length) return { tipo: 'mov', items: [{ tipo: 'borrar', producto: mayus(pb.map(function (x) { return x.o; }).join(' ')), cantidad: 0, unidad: null }] };
    }

    // "se terminó el arroz" / "no hay más leche" / "el arroz se terminó"
    var FIN = '(?:se (?:nos |me )?(?:termino|acabo|terminaron|acabaron)|no (?:hay|queda|quedan|tenemos) mas|ya no (?:hay|queda|quedan))';
    var pt = null;
    if ((m = new RegExp('^' + FIN + ' (.+)$').exec(nt))) pt = quitarPrefijo(toks, nt, m[1]);
    else if ((m = new RegExp('^(.+?) ' + FIN + '$').exec(nt))) pt = toks.slice(0, m[1].split(' ').length);
    if (pt) {
      var fin = leerItems(pt, 'ajuste').map(function (it) { it.cantidad = 0; it.unidad = null; delete it.venc; return it; });
      if (fin.length) return { tipo: 'mov', items: fin };
    }

    // preguntas
    if (/^(cuant[oa]s?|que cantidad)\b/.test(nt)) return consulta(toks.slice(nt.indexOf('que cantidad') === 0 ? 2 : 1));
    var pref = ['nos quedan', 'nos queda', 'ahora hay', 'en realidad hay', 'hay', 'quedan', 'queda', 'tenemos', 'tengo'];
    for (var i = 0; i < pref.length; i++) {
      if (nt === pref[i] || nt.indexOf(pref[i] + ' ') === 0) {
        var resto = toks.slice(pref[i].split(' ').length);
        if (resto.length && esCant(resto[0])) {
          var aj = leerItems(resto, 'ajuste');
          if (aj.length) return { tipo: 'mov', items: aj };
        }
        return consulta(resto);
      }
    }
    if ((m = /^(?:corregir|corrijo|corregi|ajustar|ajuste) (.+)$/.exec(nt))) {
      var co = leerItems(quitarPrefijo(toks, nt, m[1]), 'ajuste').filter(function (it) { return !it.implicita; });
      if (co.length) return { tipo: 'mov', items: co };
    }

    // compras y retiros (puede haber varios en un mismo mensaje)
    var clausulas = [], cur = null;
    toks.forEach(function (t) {
      if (ENT[t.n] || SAL[t.n]) { cur = { tipo: ENT[t.n] ? 'entrada' : 'salida', toks: [] }; clausulas.push(cur); }
      else if (cur) cur.toks.push(t);
    });
    var items = [];
    clausulas.forEach(function (c) { items = items.concat(leerItems(c.toks, c.tipo)); });
    if (items.length) return { tipo: 'mov', items: items };

    // sin verbo: "2 leches" → preguntar si entró o salió
    if (!clausulas.length) {
      var sueltos = leerItems(toks, null);
      if (sueltos.length && (sueltos.some(function (s) { return !s.implicita; }) || toks.length <= 3)) return { tipo: 'duda', items: sueltos };
    }
    return { tipo: 'nose' };
  }

  function consulta(toks) {
    toks = toks.slice();
    while (toks.length && (STOPQ[toks[0].n] || UNI[toks[0].n])) toks.shift();
    while (toks.length && STOPQ[toks[toks.length - 1].n]) toks.pop();
    if (!toks.length) return { tipo: 'lista' };
    return { tipo: 'consulta', producto: mayus(toks.map(function (x) { return x.o; }).join(' ')) };
  }

  /* ---------- Aplicar al inventario ----------
     El inventario es una lista de LOTES: { producto, cantidad, unidad, venc, act }.
     Un mismo producto puede tener varios lotes con distinto vencimiento ('' = no vence). */

  function porVenc(a, b) { var x = a.venc || '9999', y = b.venc || '9999'; return x < y ? -1 : x > y ? 1 : 0; }

  function productos(inv) {
    var mapa = {}, out = [];
    inv.forEach(function (l) {
      var k = clave(l.producto), g = mapa[k];
      if (!g) { g = mapa[k] = { producto: l.producto, clave: k, unidad: l.unidad, total: 0, lotes: [] }; out.push(g); }
      g.lotes.push(l); g.total = red(g.total + l.cantidad);
    });
    out.forEach(function (g) { g.lotes.sort(porVenc); });
    return out;
  }

  /* Devuelve { p: producto } , { amb: [nombres] } o {} */
  function buscar(inv, nombre) {
    var k = clave(nombre), gs = productos(inv), i, cands = [];
    if (!k) return {};
    for (i = 0; i < gs.length; i++) if (gs[i].clave === k) return { p: gs[i] };
    var kw = k.split(' ');
    gs.forEach(function (g) { var w = g.clave.split(' '); if (kw.every(function (x) { return w.indexOf(x) >= 0; })) cands.push(g); });
    if (cands.length === 1) return { p: cands[0] };
    if (cands.length > 1) return { amb: cands.map(function (g) { return g.producto; }) };
    return {};
  }

  function vivos(p) { return p.lotes.filter(function (l) { return l.cantidad > 0; }); }
  function total(inv, k) { var t = 0; inv.forEach(function (l) { if (clave(l.producto) === k) t += l.cantidad; }); return red(t); }

  /* Saca los lotes en cero; si el producto se quedó sin nada, deja una sola fila en cero. */
  function limpiar(inv, k) {
    var idx = [];
    inv.forEach(function (l, i) { if (clave(l.producto) === k) idx.push(i); });
    var hay = idx.some(function (i) { return inv[i].cantidad > 0; });
    for (var j = idx.length - 1; j >= 0; j--) {
      var l = inv[idx[j]];
      if (l.cantidad > 0) continue;
      if (hay || j > 0) inv.splice(idx[j], 1); else l.venc = '';
    }
  }

  function loteTxt(l, hoy) {
    if (!l.venc) return cant(l.cantidad, l.unidad) + ' sin vencimiento';
    var a = aviso(l.venc, hoy);
    return cant(l.cantidad, l.unidad) + (red(l.cantidad) === 1 ? ' vence ' : ' vencen ') + fmtFecha(l.venc) + (a ? ' (' + a + ')' : '');
  }
  function resumen(p, hoy) {
    if (p.total === 0) return p.producto + ': no queda';
    var v = vivos(p);
    if (v.length === 1 && !v[0].venc) return p.producto + ': ' + cantTxt(p.total, p.unidad);
    return p.producto + ': ' + cantTxt(p.total, p.unidad) + '\n' + v.map(function (l) { return '   · ' + loteTxt(l, hoy); }).join('\n');
  }

  /* Qué hay que preguntarle a la persona antes de guardar:
     { pregunta: 'venc' }  → si tiene fecha de vencimiento
     { pregunta: 'lote', opciones: [lotes] } → de cuál fecha es el que saca
     {} → nada, se puede guardar */
  function preparar(inv, it) {
    if (it.tipo === 'entrada') return it.venc === undefined ? { pregunta: 'venc' } : {};
    if (it.tipo !== 'salida' && !(it.tipo === 'ajuste' && it.cantidad > 0)) return {};
    var p = buscar(inv, it.producto).p, v = p ? vivos(p) : [];
    if (it.tipo === 'ajuste' && !v.length) return it.venc === undefined ? { pregunta: 'venc' } : {};
    if (v.length > 1 && (it.venc === undefined || !v.some(function (l) { return (l.venc || '') === it.venc; }))) return { pregunta: 'lote', opciones: v, producto: p.producto };
    if (v.length === 1) delete it.venc;
    return {};
  }

  function aplicar(inv, it, ahora, hoy) {
    var b = buscar(inv, it.producto), movs = [], p = b.p, k, nota = '';
    if (b.amb) return { ok: false, movs: [], msg: 'Hay varios productos parecidos a "' + it.producto + '": ' + b.amb.join(', ') + '. Escribilo con el nombre completo.' };
    function mov(tipo, l, cambio) { movs.push({ tipo: tipo, producto: l.producto, cambio: red(cambio), unidad: l.unidad, venc: l.venc || '' }); l.act = ahora; }
    function fin(msg) { limpiar(inv, k); var t = total(inv, k); movs.forEach(function (m) { m.stock = t; }); return { ok: true, msg: msg + nota, movs: movs }; }
    function no(msg) { return { ok: false, msg: msg, movs: [] }; }
    function nuevoLote(venc) { var l = { producto: p.producto, cantidad: 0, unidad: p.unidad, venc: venc || '', act: ahora }; inv.push(l); p.lotes.push(l); return l; }

    if (it.tipo === 'borrar') {
      if (!p) return no('No encontré "' + it.producto + '" en el inventario.');
      p.lotes.forEach(function (l) { mov('Eliminado', l, -l.cantidad); inv.splice(inv.indexOf(l), 1); });
      movs.forEach(function (m) { m.stock = 0; });
      return { ok: true, msg: 'Eliminé ' + p.producto + ' del inventario.', movs: movs };
    }
    if (!p) {
      if (it.tipo === 'salida') return no('No encontré "' + it.producto + '" en el inventario, así que no desconté nada. Si hay, anotalo primero: "hay 3 ' + it.producto.toLowerCase() + '".');
      p = { producto: it.producto, clave: clave(it.producto), unidad: it.unidad || 'unidad', total: 0, lotes: [] };
      nuevoLote('');
    }
    k = p.clave;
    var q = it.cantidad, u, v = vivos(p);
    if (it.unidad && it.unidad !== p.unidad) {
      var f = CONV[it.unidad + '>' + p.unidad];
      if (f) q = red(q * f);
      else if (p.total === 0 && it.tipo !== 'salida') { p.unidad = it.unidad; p.lotes.forEach(function (l) { l.unidad = it.unidad; }); }
      else nota = '\n(Este producto está anotado en ' + plural(p.unidad) + ', lo conté así.)';
    }
    u = p.unidad;

    if (it.tipo === 'entrada') {
      if (!(q > 0)) return no('No entendí la cantidad de ' + p.producto + '.');
      var venc = it.venc || '';
      var l = v.filter(function (x) { return (x.venc || '') === venc; })[0] || p.lotes.filter(function (x) { return x.cantidad === 0; })[0] || nuevoLote(venc);
      if (l.cantidad === 0) l.venc = venc;
      l.cantidad = red(l.cantidad + q); mov('Entrada', l, q);
      var t = red(p.total + q);
      if (venc && venc < hoy) nota += '\nOjo: esa fecha ya pasó.';
      return fin(p.producto + ': sumé ' + cant(q, u) + (venc ? ' (vence ' + fmtFecha(venc) + ')' : ' (sin vencimiento)') + '. Ahora hay ' + cant(t, u) + (t !== l.cantidad ? ' en total' : '') + '.');
    }

    if (it.tipo === 'salida') {
      if (!v.length) return no(p.producto + ': no queda nada anotado, así que no desconté nada.');
      var sacado = 0, ultimo = null, msg;
      if (it.venc !== undefined && v.length > 1) {
        ultimo = v.filter(function (x) { return (x.venc || '') === it.venc; })[0];
        if (!ultimo) return no('No hay ' + p.producto + ' con esa fecha. Hay:\n' + v.map(function (x) { return '   · ' + loteTxt(x, hoy); }).join('\n'));
        sacado = Math.min(q, ultimo.cantidad);
        ultimo.cantidad = red(ultimo.cantidad - sacado); mov('Salida', ultimo, -sacado);
        if (q > sacado) nota += '\nSolo había ' + cant(sacado, u) + ' con esa fecha.';
      } else {
        var resto = q;                                  // primero lo que vence antes
        v.forEach(function (x) {
          if (resto <= 0) return;
          var c = Math.min(resto, x.cantidad);
          x.cantidad = red(x.cantidad - c); resto = red(resto - c); sacado = red(sacado + c); mov('Salida', x, -c); ultimo = x;
        });
        if (resto > 0) nota += '\nSolo había ' + cant(sacado, u) + ', quedó en cero.';
      }
      var queda = red(p.total - sacado);
      msg = p.producto + ': saqué ' + cant(sacado, u) + (movs.length === 1 && ultimo.venc ? ' (vence ' + fmtFecha(ultimo.venc) + ')' : '') + '. ';
      msg += queda === 0 ? 'No queda más, hay que comprar.' : (queda === 1 ? 'Queda ' : 'Quedan ') + cant(queda, u) + '.';
      if (movs.length === 1 && ultimo.venc && ultimo.venc < hoy) nota += '\nOjo: ese estaba vencido.';
      var antes = vivos(p).filter(function (x) { return x !== ultimo && x.venc && (!ultimo.venc || x.venc < ultimo.venc); });
      if (antes.length) {
        var n = red(antes.reduce(function (a, x) { return a + x.cantidad; }, 0)), uno = n === 1;
        nota += '\n⚠️ Atención: ' + (uno ? 'queda ' : 'quedan ') + cant(n, u) + (uno ? ' que vence' : ' que vencen') + ' antes (' + fmtFecha(antes[0].venc) +
          (aviso(antes[0].venc, hoy) ? ', ' + aviso(antes[0].venc, hoy) : '') + '). Conviene usar ' + (uno ? 'ese' : 'esos') + ' primero.';
      }
      return fin(msg);
    }

    // ajuste: "hay 12 huevos", "se terminó el arroz"
    if (q === 0 && it.venc === undefined) {
      v.forEach(function (x) { mov('Ajuste', x, -x.cantidad); x.cantidad = 0; });
      return fin(p.producto + ': anotado, no queda más.');
    }
    var lote;
    if (it.venc !== undefined) lote = p.lotes.filter(function (x) { return x.cantidad > 0 && (x.venc || '') === it.venc; })[0] || p.lotes.filter(function (x) { return x.cantidad === 0; })[0] || nuevoLote(it.venc);
    else if (v.length > 1) return no(p.producto + ' tiene varias fechas de vencimiento. Decime de cuál, por ejemplo: "hay 3 ' + p.producto.toLowerCase() + ' que vencen ' + fmtFecha(v[0].venc || v[1].venc) + '".');
    else lote = v[0] || p.lotes[0];
    if (lote.cantidad === 0 && it.venc !== undefined) lote.venc = it.venc;
    var dif = red(q - lote.cantidad);
    lote.cantidad = red(q); mov('Ajuste', lote, dif);
    var tot = red(p.total + dif);
    if (lote.venc && lote.venc < hoy && q > 0) nota += '\nOjo: esa fecha ya pasó.';
    return fin(p.producto + ': anotado, hay ' + cant(q, u) + (lote.venc ? (q === 1 ? ' que vence ' : ' que vencen ') + fmtFecha(lote.venc) : '') + '.' + (tot !== q ? ' En total hay ' + cant(tot, u) + '.' : ''));
  }

  function ordenar(inv) {
    inv.sort(function (a, b) {
      var x = sa(a.producto.toLowerCase()), y = sa(b.producto.toLowerCase());
      return x < y ? -1 : x > y ? 1 : porVenc(a, b);
    });
  }

  /* estado = { inv:[lotes], ultimos:[movimientos del último mensaje], ahora:'ISO', hoy:'AAAA-MM-DD' }
     Devuelve { resp, movs, cambio } */
  function procesar(estado, req) {
    var inv = estado.inv, movs = [], ahora = estado.ahora, hoy = estado.hoy || String(ahora).slice(0, 10), quien = String(req.quien || '').slice(0, 30);
    var id = req.id || String(Date.now());
    inv.forEach(function (l) { l.venc = l.venc || ''; });
    function reg(mov, mensaje) { mov.id = id; mov.fecha = ahora; mov.quien = quien; mov.mensaje = mensaje || ''; movs.push(mov); }

    if (req.a === 'mov') {
      var res = (req.items || []).slice(0, 30).map(function (it) {
        var limpio = { tipo: it.tipo, producto: mayus(String(it.producto || '').slice(0, 60)), cantidad: Math.abs(Number(it.cantidad)) || 0, unidad: UNI[it.unidad] ? it.unidad : null };
        if (typeof it.venc === 'string') limpio.venc = /^\d{4}-\d{2}-\d{2}$/.test(it.venc) ? it.venc : '';
        var r = aplicar(inv, limpio, ahora, hoy);
        r.movs.forEach(function (m) { reg(m, String(req.texto || '').slice(0, 200)); });
        return { ok: r.ok, msg: r.msg };
      });
      ordenar(inv);
      return { resp: { ok: true, res: res, inv: inv }, movs: movs, cambio: movs.length > 0 };
    }

    if (req.a === 'undo') {
      var ult = estado.ultimos || [];
      if (!ult.length || ult[0].tipo === 'Deshacer') return { resp: { ok: true, res: [{ ok: false, msg: 'No hay nada para deshacer.' }], inv: inv }, movs: [], cambio: false };
      var tocados = {}, orden = [];
      ult.forEach(function (u) {
        var k = clave(u.producto), venc = u.venc || '', cambio = Number(u.cambio) || 0, lote = null, cero = null;
        inv.forEach(function (l) {
          if (clave(l.producto) !== k) return;
          if (l.cantidad === 0) cero = cero || l;
          else if ((l.venc || '') === venc) lote = l;
        });
        if (!lote) {
          if (u.tipo !== 'Eliminado' && cambio >= 0) return;          // no hay nada que devolver
          lote = cero || { producto: u.producto, cantidad: 0, unidad: u.unidad || 'unidad', venc: venc, act: ahora };
          lote.venc = venc;
          if (!cero) inv.push(lote);
        }
        lote.cantidad = red(Math.max(0, lote.cantidad - cambio)); lote.act = ahora;
        if (!tocados[k]) { tocados[k] = { nombre: lote.producto, unidad: lote.unidad, nuevo: false }; orden.push(k); }
        if (u.tipo !== 'Salida' && cambio > 0 && red(u.stock) === red(cambio)) tocados[k].nuevo = true;   // ese mensaje lo había creado
        reg({ tipo: 'Deshacer', producto: lote.producto, cambio: -cambio, unidad: lote.unidad, venc: venc }, 'deshacer');
      });
      var partes = orden.map(function (k) {
        limpiar(inv, k);
        var t = total(inv, k), x = tocados[k], quitado = x.nuevo && t === 0;
        if (quitado) for (var i = inv.length - 1; i >= 0; i--) if (clave(inv[i].producto) === k) inv.splice(i, 1);
        movs.forEach(function (m) { if (clave(m.producto) === k) m.stock = t; });
        return x.nombre + (quitado ? ' (quitado)' : ' (ahora hay ' + cant(t, x.unidad) + ')');
      });
      ordenar(inv);
      if (!movs.length) return { resp: { ok: true, res: [{ ok: false, msg: 'No hay nada para deshacer.' }], inv: inv }, movs: [], cambio: false };
      return { resp: { ok: true, res: [{ ok: true, msg: 'Listo, deshice lo último: ' + partes.join(', ') + '.' }], inv: inv }, movs: movs, cambio: true };
    }
    return { resp: { ok: true, inv: inv }, movs: [], cambio: false };
  }

  return { entender: entender, preparar: preparar, procesar: procesar, productos: productos, buscar: buscar, resumen: resumen, loteTxt: loteTxt,
    parseFecha: parseFecha, fmtFecha: fmtFecha, aviso: aviso, dias: dias, hoyLocal: hoyLocal,
    clave: clave, cant: cant, cantTxt: cantTxt, fmt: fmt, sinAcentos: sa };
})();
if (typeof module !== 'undefined') module.exports = Core;
