/* Retired size switch. Keep the asset URL compatible with cached shells.
 * Cards use their default layout; legacy size preferences are ignored. */
(function() {
  "use strict";
  document.documentElement.removeAttribute("data-lease-list-view-v80");
  var controls = document.getElementById("leaseListViewV80");
  if (controls) controls.remove();
})();
