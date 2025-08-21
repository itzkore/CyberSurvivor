<?php
http_response_code(410);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['error' => 'legacy_endpoint_removed']);
exit; // File intentionally ends here; legacy PHP implementation removed.