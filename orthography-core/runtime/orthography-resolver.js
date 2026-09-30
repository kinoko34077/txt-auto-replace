(function (root, factory) {
  const api = factory(root.TransformShared);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OrthographyResolver = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (TransformShared) {
  "use strict";

  const emptyContextualDecision = () => ({
    status: "none",
    target: null,
    candidates: [],
    relationIds: []
  });

  const emptyHistorical = (surface, disposition = "UNRESOLVED") => ({
    route: null,
    kana: null,
    contextualKanji: emptyContextualDecision(),
    deterministicKanji: null,
    surface,
    disposition,
    evidenceRefs: []
  });

  const normalizeInputEvidence = (input) => {
    const sourceText = `${input ?? ""}`;
    const parseRubySegments = TransformShared?.parseRubySegments;
    if (typeof parseRubySegments !== "function") {
      return {
        sourceText,
        baseSurface: sourceText,
        wholeRuby: null,
        componentRuby: []
      };
    }

    const segments = parseRubySegments(sourceText);
    const rubySegments = segments.filter((segment) => segment?.type === "ruby");
    if (rubySegments.length === 0) {
      return {
        sourceText,
        baseSurface: sourceText,
        wholeRuby: null,
        componentRuby: []
      };
    }

    const baseSurface = segments.map((segment) => (
      segment?.type === "ruby" ? `${segment.base ?? ""}` : `${segment?.text ?? ""}`
    )).join("");

    const wholeRuby = segments.length === 1 && rubySegments.length === 1 && rubySegments[0].base === baseSurface
      ? { base: rubySegments[0].base, reading: rubySegments[0].ruby }
      : null;

    return {
      sourceText,
      baseSurface,
      wholeRuby,
      componentRuby: wholeRuby ? [] : rubySegments.map((segment) => ({
        base: `${segment.base ?? ""}`,
        reading: `${segment.ruby ?? ""}`
      }))
    };
  };

  const unresolvedUnit = (evidence, candidates = []) => ({
    kind: candidates.length > 1 ? "candidates" : "unresolved",
    sourceText: evidence.sourceText,
    sourceSurface: evidence.baseSurface,
    lexicalIdentity: null,
    reading: {
      modernSurface: evidence.wholeRuby?.reading ?? null,
      source: evidence.wholeRuby ? "ruby-word" : "unknown"
    },
    lexicalOrigin: "unknown",
    morphology: null,
    components: [],
    lexicalCandidates: candidates,
    historical: emptyHistorical(
      evidence.baseSurface,
      candidates.length > 1 ? "CANDIDATES" : "UNRESOLVED"
    ),
    evidenceRefs: []
  });

  const attachComponentRuby = (components, componentRuby) => {
    if (!Array.isArray(components) || components.length === 0) {
      return [];
    }

    let rubyIndex = 0;
    return components.map((component) => {
      const explicit = componentRuby[rubyIndex];
      const matches = explicit && explicit.base === component.surface;
      if (matches) {
        rubyIndex += 1;
      }
      return {
        ...component,
        readingSource: matches ? "ruby-component" : "lexical"
      };
    });
  };

  const relationBindingIds = (entry) => (
    Array.isArray(entry?.lexicalBindingIds) ? entry.lexicalBindingIds : []
  );

  const bindingEligible = (entry, candidate) => {
    const required = relationBindingIds(entry);
    if (required.length === 0) {
      return true;
    }
    const viable = Array.isArray(candidate?.viableBindingIds) ? candidate.viableBindingIds : [];
    return viable.some((bindingId) => required.includes(bindingId));
  };

  const resolveContextualKanji = (surface, candidate, relations, safety) => {
    const preserve = (Array.isArray(safety) ? safety : []).find((entry) => (
      entry?.effect === "preserve_exact" && entry.match === surface && bindingEligible(entry, candidate)
    ));
    if (preserve) {
      return {
        status: "preserve",
        target: null,
        candidates: [],
        relationIds: [preserve.id].filter(Boolean)
      };
    }

    const matchingRelations = (Array.isArray(relations) ? relations : []).filter((entry) => (
      entry?.match === surface && typeof entry?.target === "string"
    ));
    const viable = Array.isArray(candidate?.viableBindingIds) ? candidate.viableBindingIds : [];
    const eligibleRelations = matchingRelations.filter((entry) => bindingEligible(entry, candidate));
    const targets = [];
    for (const relation of eligibleRelations) {
      if (!targets.includes(relation.target)) {
        targets.push(relation.target);
      }
    }

    if (targets.length === 0) {
      return emptyContextualDecision();
    }

    const hasGlobalRelation = eligibleRelations.some((entry) => relationBindingIds(entry).length === 0);
    const coversAllViableBindings = hasGlobalRelation || (
      viable.length > 0 && viable.every((bindingId) => (
        eligibleRelations.some((entry) => relationBindingIds(entry).includes(bindingId))
      ))
    );

    if (targets.length === 1 && coversAllViableBindings) {
      return {
        status: "resolved",
        target: targets[0],
        candidates: targets,
        relationIds: eligibleRelations.map((entry) => entry.id).filter(Boolean)
      };
    }

    return {
      status: "candidates",
      target: null,
      candidates: targets,
      relationIds: eligibleRelations.map((entry) => entry.id).filter(Boolean)
    };
  };

  const applySafeKanjiMap = (surface, safeKanjiMap) => Array.from(`${surface ?? ""}`).map((char) => (
    Object.prototype.hasOwnProperty.call(safeKanjiMap ?? {}, char) ? safeKanjiMap[char] : char
  )).join("");

  const resolveHistoricalComponents = (components, acceptedRelation, safeKanjiMap, options = {}) => {
    const relationComponents = Array.isArray(acceptedRelation?.components) ? acceptedRelation.components : [];
    if (!Array.isArray(components) || components.length === 0) {
      if (options.allowRelationFallback === false) {
        return [];
      }
      return relationComponents.map((component) => ({
        ...component,
        renderedSurface: applySafeKanjiMap(component.surface, safeKanjiMap)
      }));
    }

    const componentRelations = new Map(
      relationComponents.map((component) => [component.lexicalIdentity, component])
    );
    return components.map((component) => {
      const componentRelation = componentRelations.get(component.lexicalIdentity);
      return {
        ...component,
        historicalKana: componentRelation?.historicalKana ?? null,
        renderedSurface: applySafeKanjiMap(component.surface, safeKanjiMap)
      };
    });
  };

  const resolveHistorical = (candidate, sourceSurface, components, config) => {
    const relation = typeof config.historicalLookup === "function"
      ? config.historicalLookup(candidate)
      : null;
    const relationAllowed = !relation?.requiresMorphology || candidate?.morphology != null;
    const acceptedRelation = relationAllowed ? relation : null;
    const contextualKanji = resolveContextualKanji(
      sourceSurface,
      candidate,
      config.contextualRelations,
      config.contextualSafety
    );

    const resolvedComponents = resolveHistoricalComponents(
      components,
      acceptedRelation,
      config.safeKanjiMap ?? {},
      { allowRelationFallback: contextualKanji.status !== "resolved" }
    );

    if (contextualKanji.status === "preserve") {
      return {
        components: resolvedComponents,
        historical: {
          route: acceptedRelation?.route ?? null,
          kana: acceptedRelation?.reading ?? null,
          contextualKanji,
          deterministicKanji: null,
          surface: sourceSurface,
          disposition: "PRESERVE",
          evidenceRefs: [...(acceptedRelation?.evidenceRefs ?? [])]
        }
      };
    }

    if (contextualKanji.status === "candidates") {
      return {
        components: resolvedComponents,
        historical: {
          route: acceptedRelation?.route ?? null,
          kana: acceptedRelation?.reading ?? null,
          contextualKanji,
          deterministicKanji: null,
          surface: sourceSurface,
          disposition: "CANDIDATES",
          evidenceRefs: [...(acceptedRelation?.evidenceRefs ?? [])]
        }
      };
    }

    if (contextualKanji.status === "resolved") {
      return {
        components: resolvedComponents,
        historical: {
          route: acceptedRelation?.route ?? null,
          kana: acceptedRelation?.reading ?? null,
          contextualKanji,
          deterministicKanji: null,
          surface: contextualKanji.target,
          disposition: "AUTO",
          evidenceRefs: [...(acceptedRelation?.evidenceRefs ?? [])]
        }
      };
    }

    const relationSurface = acceptedRelation?.surface ?? sourceSurface;
    const renderedSurface = applySafeKanjiMap(relationSurface, config.safeKanjiMap ?? {});
    const deterministicKanji = renderedSurface === relationSurface
      ? null
      : {
          status: "resolved",
          source: relationSurface,
          target: renderedSurface
        };

    return {
      components: resolvedComponents,
      historical: {
        route: acceptedRelation?.route ?? null,
        kana: acceptedRelation?.reading ?? null,
        contextualKanji,
        deterministicKanji,
        surface: renderedSurface,
        disposition: acceptedRelation || deterministicKanji ? "AUTO" : "SOURCE_REVIEW",
        evidenceRefs: [...(acceptedRelation?.evidenceRefs ?? [])]
      }
    };
  };

  const protectedUnit = (sourceText) => ({
    kind: "protected",
    sourceText,
    sourceSurface: sourceText,
    lexicalIdentity: null,
    reading: { modernSurface: null, source: "protected" },
    lexicalOrigin: "unknown",
    morphology: null,
    components: [],
    historical: emptyHistorical(sourceText, "PRESERVE"),
    evidenceRefs: []
  });

  const createResolver = (config = {}) => {
    if (typeof config.lexicalLookup !== "function") {
      throw new TypeError("createResolver requires lexicalLookup(surface)");
    }

    // The single semantic path shared by every analysis route (surface, reading).
    const resolveCandidate = (evidence, candidate, lexicalSurface, reading) => {
      const historicalResolution = resolveHistorical(
        candidate,
        lexicalSurface,
        candidate.components ?? [],
        config
      );
      const components = attachComponentRuby(historicalResolution.components, evidence.componentRuby);

      return {
        kind: "resolved",
        sourceText: evidence.sourceText,
        sourceSurface: evidence.baseSurface,
        lexicalIdentity: candidate.lexicalIdentity ?? null,
        lemma: candidate.lemma ?? null,
        reading,
        lexicalOrigin: candidate.lexicalOrigin ?? "unknown",
        morphology: candidate.morphology ?? null,
        components,
        viableBindingIds: candidate.viableBindingIds ?? [],
        historical: historicalResolution.historical,
        evidenceRefs: [
          ...(candidate.evidenceRefs ?? []),
          ...(historicalResolution.historical.evidenceRefs ?? [])
        ]
      };
    };

    const resolveUnit = (input, options = {}) => {
      const evidence = normalizeInputEvidence(input);

      if (options.protected === true) {
        return protectedUnit(evidence.sourceText);
      }

      const lookupResult = config.lexicalLookup(evidence.baseSurface) ?? [];
      const candidates = Array.isArray(lookupResult) && evidence.wholeRuby?.reading
        ? lookupResult.filter((candidate) => (candidate?.reading === evidence.wholeRuby.reading || (Array.isArray(candidate?.modernReadings) && candidate.modernReadings.includes(evidence.wholeRuby.reading))))
        : lookupResult;
      if (!Array.isArray(candidates) || candidates.length !== 1) {
        return unresolvedUnit(evidence, Array.isArray(candidates) ? candidates : []);
      }

      const candidate = candidates[0];
      const reading = evidence.wholeRuby
        ? { modernSurface: evidence.wholeRuby.reading, source: "ruby-word" }
        : { modernSurface: candidate.reading ?? null, source: candidate.reading ? "lexical" : "unknown" };
      return resolveCandidate(evidence, candidate, evidence.baseSurface, reading);
    };

    // Reading input: candidates come from the reading index and enter the same
    // semantic path directly; no reconstructed string is re-looked-up.
    const resolveReading = (input, options = {}) => {
      const sourceText = `${input ?? ""}`;
      if (options.protected === true) {
        return protectedUnit(sourceText);
      }
      if (typeof config.readingLookup !== "function") {
        throw new TypeError("resolveReading requires readingLookup(reading)");
      }
      const evidence = { sourceText, baseSurface: sourceText, wholeRuby: null, componentRuby: [] };
      const lookupResult = config.readingLookup(sourceText) ?? [];
      const candidates = Array.isArray(lookupResult) ? lookupResult : [];
      if (candidates.length !== 1 || typeof candidates[0]?.surface !== "string") {
        return unresolvedUnit(evidence, candidates);
      }

      const candidate = candidates[0];
      return {
        ...resolveCandidate(evidence, candidate, candidate.surface, { modernSurface: sourceText, source: "reading-input" }),
        reconstructedSurface: candidate.surface
      };
    };

    const render = (unit, options = {}) => {
      if (!unit) {
        return "";
      }
      if (unit.kind === "protected") {
        return unit.sourceText ?? unit.sourceSurface ?? "";
      }

      const mode = options.mode ?? "plain";
      const surface = unit?.historical?.surface ?? unit?.sourceSurface ?? unit?.sourceText ?? "";
      const historicalKana = unit?.historical?.kana ?? null;
      if (mode === "plain" || !historicalKana) {
        return surface;
      }

      if (mode === "ruby-whole-explicit") {
        return `｜${surface}《${historicalKana}》`;
      }
      if (mode === "ruby-whole-implicit") {
        return `${surface}《${historicalKana}》`;
      }

      const components = Array.isArray(unit.components) ? unit.components : [];
      const componentRuby = components.map((component) => {
        const componentSurface = component.renderedSurface ?? component.surface ?? "";
        const componentKana = component.historicalKana ?? component.lexicalReading ?? null;
        return componentKana ? `${componentSurface}《${componentKana}》` : componentSurface;
      }).join("");

      if (mode === "ruby-components-explicit") {
        return componentRuby ? `｜${componentRuby}` : `｜${surface}《${historicalKana}》`;
      }
      if (mode === "ruby-components-implicit") {
        return componentRuby || `${surface}《${historicalKana}》`;
      }

      return surface;
    };

    return {
      resolveUnit,
      resolveReading,
      render
    };
  };

  return {
    createResolver
  };
});
