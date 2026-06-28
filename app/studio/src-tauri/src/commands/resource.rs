use resourcefs::Vfs;
use serde::Serialize;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Component, Path};
use tauri::State;

use crate::AppState;

#[derive(Debug, Serialize)]
pub struct DiagnosticDto {
    severity: &'static str,
    message: String,
    line: usize,
    column: usize,
}

#[derive(Debug, Serialize, Default)]
pub struct MaterialSummaryDto {
    shader: Option<String>,
    layers: Vec<String>,
    unique_defines: Vec<String>,
    ignore_defines: Vec<String>,
    render_state: serde_json::Value,
    passes: Vec<String>,
    presets: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShaderFileDto {
    path: String,
    includes: Vec<String>,
    missing_includes: Vec<String>,
    defines: Vec<String>,
    conditions: Vec<String>,
    properties: Vec<String>,
    uniforms: Vec<String>,
    entry_points: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ShaderIndexDto {
    files: Vec<ShaderFileDto>,
    macros: Vec<String>,
    cycles: Vec<Vec<String>>,
}

#[tauri::command]
pub fn resource_validate(kind: String, text: String) -> Vec<DiagnosticDto> {
    if !matches!(kind.as_str(), "yaml" | "material" | "json") {
        return Vec::new();
    }
    let result = if kind == "json" {
        serde_json::from_str::<serde_json::Value>(&text).map(|_| ()).map_err(|error| {
            (error.to_string(), error.line(), error.column())
        })
    } else {
        serde_yaml::from_str::<serde_yaml::Value>(&text).map(|_| ()).map_err(|error| {
            let location = error.location();
            (error.to_string(), location.as_ref().map(|v| v.line()).unwrap_or(1), location.as_ref().map(|v| v.column()).unwrap_or(1))
        })
    };
    result.err().map(|(message, line, column)| vec![DiagnosticDto { severity: "error", message, line, column }]).unwrap_or_default()
}

#[tauri::command]
pub fn resource_format(kind: String, text: String) -> Result<String, String> {
    match kind.as_str() {
        "yaml" | "material" => {
            let value: serde_yaml::Value = serde_yaml::from_str(&text).map_err(|e| e.to_string())?;
            serde_yaml::to_string(&value).map_err(|e| e.to_string())
        }
        "json" => {
            let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
        }
        _ => Err("Formatting is only available for YAML, material, and JSON resources.".into()),
    }
}

fn yaml_strings(value: Option<&serde_yaml::Value>) -> Vec<String> {
    value.and_then(|v| v.as_sequence()).map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_owned)).collect()).unwrap_or_default()
}

#[tauri::command]
pub fn material_inspect(text: String) -> Result<MaterialSummaryDto, String> {
    let root: serde_yaml::Value = serde_yaml::from_str(&text).map_err(|e| e.to_string())?;
    let material = root.get("Material").unwrap_or(&root);
    let keys = |name: &str| material.get(name).and_then(|v| v.as_mapping()).map(|m| m.keys().filter_map(|k| k.as_str().map(str::to_owned)).collect()).unwrap_or_default();
    Ok(MaterialSummaryDto {
        shader: material.get("Shader").and_then(|v| v.as_str()).map(str::to_owned),
        layers: yaml_strings(material.get("Layers")),
        unique_defines: yaml_strings(material.get("UniqueDefines")),
        ignore_defines: yaml_strings(material.get("IgnoreDefines")),
        render_state: material.get("RenderState").map(|v| serde_json::to_value(v).unwrap_or_default()).unwrap_or_default(),
        passes: keys("Passes"),
        presets: keys("Presets"),
    })
}

fn normalize_virtual(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::ParentDir => { parts.pop()?; }
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(parts.join("/"))
}

fn parse_include(line: &str) -> Option<&str> {
    let line = line.trim();
    if !line.starts_with("#include") { return None; }
    let start = line.find(['\"', '<'])? + 1;
    let end = line[start..].find(['\"', '>'])? + start;
    Some(&line[start..end])
}

fn directive_name(line: &str, directive: &str) -> Option<String> {
    line.trim().strip_prefix(directive)?.split_whitespace().next().map(str::to_owned)
}

fn declaration_name(line: &str, marker: &str) -> Option<String> {
    let clean = line.split("//").next()?.trim().trim_end_matches(';');
    if !clean.contains(marker) { return None; }
    clean.split_whitespace().last().map(|name| name.split(':').next().unwrap_or(name).to_owned())
}

fn resolve_include(source: &str, include: &str) -> Option<String> {
    if let Some(rooted) = include.strip_prefix("~res:/") { return normalize_virtual(Path::new(rooted)); }
    let parent = Path::new(source).parent().unwrap_or(Path::new(""));
    normalize_virtual(&parent.join(include))
}

fn build_shader_index(state: &State<AppState>) -> Result<ShaderIndexDto, String> {
    let guard = state.vfs.lock().unwrap();
    let vfs = guard.as_ref().ok_or("No game directory open.")?;
    let shader_paths: Vec<String> = vfs.list().into_iter().filter_map(|entry| {
        let path = entry.path.to_string_lossy().replace('\\', "/");
        matches!(Path::new(&path).extension().and_then(|e| e.to_str()), Some("sl" | "slh")).then_some(path)
    }).collect();
    let known: HashSet<_> = shader_paths.iter().cloned().collect();
    let mut macros = BTreeSet::new();
    let mut files = Vec::new();
    for path in shader_paths {
        let Ok(bytes) = vfs.read(Path::new(&path)) else { continue; };
        let text = String::from_utf8_lossy(&bytes);
        let mut includes = Vec::new();
        let mut missing = Vec::new();
        let mut defines = BTreeSet::new();
        let mut properties = BTreeSet::new();
        let mut conditions = BTreeSet::new();
        let mut uniforms = BTreeSet::new();
        let mut entry_points = BTreeSet::new();
        for line in text.lines() {
            if let Some(target) = parse_include(line).and_then(|i| resolve_include(&path, i)) {
                if !known.contains(&target) { missing.push(target.clone()); }
                includes.push(target);
            }
            for directive in ["#define", "#ensuredefined"] {
                if let Some(name) = directive_name(line, directive) { macros.insert(name.clone()); defines.insert(name); }
            }
            for directive in ["#if", "#ifdef", "#ifndef", "#elif"] {
                if let Some(expression) = line.trim().strip_prefix(directive) {
                    for token in expression.split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_').filter(|token| token.chars().next().is_some_and(|ch| ch.is_ascii_uppercase())) {
                        macros.insert(token.to_owned()); conditions.insert(token.to_owned());
                    }
                }
            }
            if let Some(name) = declaration_name(line, " property ") { properties.insert(name); }
            if let Some(name) = declaration_name(line, "uniform ") { uniforms.insert(name); }
            let trimmed = line.trim();
            if (trimmed.contains(" fp_main(") || trimmed.contains(" vp_main(")) && !trimmed.starts_with("//") {
                if let Some(name) = trimmed.split('(').next().and_then(|v| v.split_whitespace().last()) { entry_points.insert(name.to_owned()); }
            }
        }
        files.push(ShaderFileDto { path, includes, missing_includes: missing, defines: defines.into_iter().collect(), conditions: conditions.into_iter().collect(), properties: properties.into_iter().collect(), uniforms: uniforms.into_iter().collect(), entry_points: entry_points.into_iter().collect() });
    }
    let graph: HashMap<_, _> = files.iter().map(|file| (file.path.clone(), file.includes.clone())).collect();
    let mut cycles = Vec::new();
    fn visit(node: &str, graph: &HashMap<String, Vec<String>>, stack: &mut Vec<String>, done: &mut HashSet<String>, cycles: &mut Vec<Vec<String>>) {
        if let Some(index) = stack.iter().position(|item| item == node) { cycles.push(stack[index..].iter().cloned().chain(std::iter::once(node.to_owned())).collect()); return; }
        if !done.insert(node.to_owned()) { return; }
        stack.push(node.to_owned());
        if let Some(next) = graph.get(node) { for child in next { if graph.contains_key(child) { visit(child, graph, stack, done, cycles); } } }
        stack.pop();
    }
    let mut done = HashSet::new();
    for node in graph.keys() { visit(node, &graph, &mut Vec::new(), &mut done, &mut cycles); }
    Ok(ShaderIndexDto { files, macros: macros.into_iter().collect(), cycles })
}

#[tauri::command]
pub fn shader_index(state: State<AppState>) -> Result<ShaderIndexDto, String> { build_shader_index(&state) }

#[tauri::command]
pub fn shader_references(symbol: String, state: State<AppState>) -> Result<Vec<String>, String> {
    let guard = state.vfs.lock().unwrap();
    let vfs = guard.as_ref().ok_or("No game directory open.")?;
    let mut paths = Vec::new();
    for entry in vfs.list() {
        let path = entry.path.to_string_lossy().replace('\\', "/");
        if !matches!(Path::new(&path).extension().and_then(|e| e.to_str()), Some("sl" | "slh")) { continue; }
        if String::from_utf8_lossy(&vfs.read(Path::new(&path)).map_err(|e| e.to_string())?).contains(&symbol) { paths.push(path); }
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yaml_validation_reports_location() {
        let diagnostics = resource_validate("yaml".into(), "root:\n  broken: [1,\n".into());
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].line >= 2);
        assert!(diagnostics[0].column >= 1);
    }

    #[test]
    fn material_summary_extracts_known_sections() {
        let text = "Material:\n  Shader: '~res:/shader'\n  Layers: [Opaque]\n  UniqueDefines: [PBR]\n  Passes:\n    Forward: {}\n";
        let summary = material_inspect(text.into()).unwrap();
        assert_eq!(summary.shader.as_deref(), Some("~res:/shader"));
        assert_eq!(summary.layers, ["Opaque"]);
        assert_eq!(summary.unique_defines, ["PBR"]);
        assert_eq!(summary.passes, ["Forward"]);
    }

    #[test]
    fn resolves_relative_and_resource_includes_safely() {
        assert_eq!(resolve_include("Materials/Shaders/a.sl", "../common.slh").as_deref(), Some("Materials/common.slh"));
        assert_eq!(resolve_include("a.sl", "~res:/Materials/x.slh").as_deref(), Some("Materials/x.slh"));
        assert!(resolve_include("a.sl", "../../escape.slh").is_none());
    }
}
