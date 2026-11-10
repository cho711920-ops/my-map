import '../../js/building-registry-core-v164.js';
const core=globalThis.JSBuildingRegistryCoreV164;
export const BUILDING_REGISTRY_SCOPE_V164=core.scope;
export function validateBuildingRegistryV164(data,recordKey){
  if(recordKey!==core.key)throw Object.assign(new Error('건물 설정 저장 위치를 확인해 주세요.'),{statusCode:400});
  return core.validate(data);
}
