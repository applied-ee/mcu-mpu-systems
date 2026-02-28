(function () {
  "use strict";

  // Don't run on the glossary or preface pages
  var path = window.location.pathname;
  if (path.indexOf("/glossary") !== -1 || path.indexOf("/preface") !== -1) return;

  var data = window.__glossaryData;
  if (!data) return;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (e) { return; }
  }
  if (!data.length) return;

  // Build lookup: term -> { definition, anchor }
  // Include aliases as separate lookup entries
  var terms = [];
  data.forEach(function (entry) {
    var skips = (entry.skipPatterns || []).map(function (p) { return new RegExp(p, "i"); });
    var item = { term: entry.term, def: entry.definition, anchor: entry.anchor, skips: skips };
    terms.push(item);
    if (entry.aliases) {
      entry.aliases.forEach(function (alias) {
        // Skip single-letter aliases (A, C, J, etc.) — too many false matches
        if (alias.length <= 2) return;
        terms.push({ term: alias, def: entry.definition, anchor: entry.anchor, skips: skips });
      });
    }
  });

  // Sort by term length descending so longer phrases match before shorter ones
  terms.sort(function (a, b) {
    return b.term.length - a.term.length;
  });

  // Track which anchors we've already linked (first occurrence only)
  var linked = {};

  // Find the content area
  var content = document.querySelector(".book-page .markdown");
  if (!content) return;

  // Elements to skip
  var SKIP_TAGS = {
    A: true, CODE: true, PRE: true, SCRIPT: true, STYLE: true,
    H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
    TEXTAREA: true, INPUT: true
  };

  function shouldSkip(node) {
    var el = node.parentNode;
    while (el && el !== content) {
      if (SKIP_TAGS[el.tagName]) return true;
      if (el.classList && el.classList.contains("glossary-term")) return true;
      if (el.classList && el.classList.contains("no-glossary")) return true;
      el = el.parentNode;
    }
    return false;
  }

  // Collect all text nodes
  function getTextNodes(root) {
    var nodes = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      if (!shouldSkip(node) && node.textContent.trim().length > 0) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  // Escape regex special chars
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Process each term
  terms.forEach(function (entry) {
    if (linked[entry.anchor]) return;

    var textNodes = getTextNodes(content);
    var pattern = new RegExp("\\b" + escapeRegex(entry.term) + "\\b", entry.term === entry.term.toUpperCase() ? "" : "i");

    for (var i = 0; i < textNodes.length; i++) {
      var node = textNodes[i];
      var match = pattern.exec(node.textContent);
      if (!match) continue;

      // Check skip patterns — if surrounding text matches a non-EE context, skip this occurrence
      if (entry.skips.length) {
        var skipped = false;
        for (var s = 0; s < entry.skips.length; s++) {
          if (entry.skips[s].test(node.textContent)) { skipped = true; break; }
        }
        if (skipped) continue;
      }

      // Split the text node and insert the glossary link
      var before = node.textContent.substring(0, match.index);
      var matchedText = node.textContent.substring(match.index, match.index + match[0].length);
      var after = node.textContent.substring(match.index + match[0].length);

      var link = document.createElement("a");
      link.className = "glossary-term";
      link.href = (window.__glossaryBase || "/docs/glossary/") + "#" + entry.anchor;
      link.setAttribute("data-anchor", entry.anchor);

      link.appendChild(document.createTextNode(matchedText));
      link.setAttribute("data-glossary-def", entry.def);

      var parent = node.parentNode;
      if (before) parent.insertBefore(document.createTextNode(before), node);
      parent.insertBefore(link, node);
      if (after) parent.insertBefore(document.createTextNode(after), node);
      parent.removeChild(node);

      linked[entry.anchor] = true;
      break;
    }
  });

  // Shared tooltip element on document.body — avoids overflow clipping from tables etc.
  var tip = document.createElement("div");
  tip.className = "glossary-tip";
  tip.style.display = "none";
  document.body.appendChild(tip);

  document.querySelectorAll(".glossary-term").forEach(function (el) {
    el.addEventListener("mouseenter", function () {
      var def = el.getAttribute("data-glossary-def");
      if (!def) return;

      tip.textContent = def;

      // Show hidden to measure
      tip.style.visibility = "hidden";
      tip.style.display = "block";
      tip.classList.remove("tip-below");

      var termRect = el.getBoundingClientRect();
      var tipRect = tip.getBoundingClientRect();

      // Center above the term
      var top = termRect.top - tipRect.height - 6;
      var left = termRect.left + termRect.width / 2 - tipRect.width / 2;

      // Clamp horizontally to viewport
      if (left < 8) left = 8;
      if (left + tipRect.width > window.innerWidth - 8) {
        left = window.innerWidth - tipRect.width - 8;
      }

      // If no room above, flip below
      if (top < 8) {
        top = termRect.bottom + 6;
        tip.classList.add("tip-below");
      }

      // Point arrow at the term center
      var arrowLeft = termRect.left + termRect.width / 2 - left;
      tip.style.setProperty("--arrow-left", arrowLeft + "px");

      tip.style.top = top + "px";
      tip.style.left = left + "px";
      tip.style.visibility = "visible";
    });

    el.addEventListener("mouseleave", function () {
      tip.style.display = "none";
    });
  });
})();
