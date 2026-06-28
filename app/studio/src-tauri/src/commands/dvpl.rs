/// Pack raw bytes into DVPL wire format.
/// Input is base64-encoded, output is base64-encoded.
#[tauri::command]
pub fn dvpl_pack(data: Vec<u8>) -> Result<Vec<u8>, String> {
    dvpl::pack(&data).map_err(|e| e.to_string())
}

/// Unpack DVPL wire-format bytes into the original payload.
#[tauri::command]
pub fn dvpl_unpack(data: Vec<u8>) -> Result<Vec<u8>, String> {
    dvpl::unpack(&data).map_err(|e| e.to_string())
}
