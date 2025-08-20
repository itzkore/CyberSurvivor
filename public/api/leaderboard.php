<?php
// CyberSurvivor Leaderboard API
header('Content-Type: application/json; charset=utf-8');

$debug = (isset($_GET['debug']) && $_GET['debug'] === '1');

// Move these to env vars in production
$db_host = 'YOUR_HOST';
$db_user = 'YOUR_USER';
$db_pass = 'YOUR_PASS';
$db_name = 'YOUR_DB';
$db_port = 3306;

$conn = new mysqli($db_host, $db_user, $db_pass, $db_name, $db_port);
if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(['error' => 'DB connection failed', '_debug' => $debug ? $conn->connect_error : null]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $userid      = trim($data['userid'] ?? '');
    $nickname    = trim($data['nickname'] ?? '');
    $score       = (int)($data['score'] ?? 0);
    $mode        = strtoupper(trim($data['mode'] ?? 'SHOWDOWN'));
    $characterId = trim($data['characterId'] ?? '');
    $level       = (int)($data['level'] ?? 0);
    $durationSec = (int)($data['durationSec'] ?? 0);

    if ($userid === '' || $nickname === '') {
        http_response_code(400);
        echo json_encode(['error' => 'userid and nickname required']);
        exit;
    }

    $sql = "REPLACE INTO leaderboard (userid, nickname, score, mode, characterId, level, durationSec, timeISO)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())";
    $stmt = $conn->prepare($sql);
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['error' => 'Prepare failed', '_debug' => $debug ? $conn->error : null]);
        exit;
    }
    $stmt->bind_param('ssissii', $userid, $nickname, $score, $mode, $characterId, $level, $durationSec);
    if (!$stmt->execute()) {
        http_response_code(500);
        echo json_encode(['error' => 'Execute failed', '_debug' => $debug ? $stmt->error : null]);
    } else {
        echo json_encode(['success' => true]);
    }
    $stmt->close();
    $conn->close();
    exit;
}

$mode        = strtoupper(trim($_GET['mode'] ?? 'SHOWDOWN'));
$characterId = trim($_GET['characterId'] ?? '');
$limit       = (int)($_GET['limit'] ?? 20);
if ($limit < 1) $limit = 1;
if ($limit > 100) $limit = 100;

$sql = "SELECT nickname, score, mode, characterId, level, durationSec, timeISO
        FROM leaderboard
        WHERE mode = ? AND characterId = ?
        ORDER BY score DESC
        LIMIT ?";
$stmt = $conn->prepare($sql);
if (!$stmt) {
    http_response_code(500);
    echo json_encode(['error' => 'Prepare failed', '_debug' => $debug ? $conn->error : null]);
    exit;
}
$stmt->bind_param('ssi', $mode, $characterId, $limit);
$stmt->execute();
$result = $stmt->get_result();

$entries = [];
while ($row = $result->fetch_assoc()) {
    $entries[] = $row;
}

$stmt->close();
$conn->close();

$out = ['entries' => $entries];
if ($debug) {
    $out['_debug'] = ['count' => count($entries)];
}
echo json_encode($out);