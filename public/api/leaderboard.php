<?php
// CyberSurvivor Leaderboard API (PHP, Forpsi webhosting)
header('Content-Type: application/json; charset=utf-8');

// DB config
$db_host = 'a066um.forpsi.com';
$db_user = 'f190888';
$db_pass = 'fHaFme9W';
$db_name = 'f190888';
<?php
// CyberSurvivor Leaderboard API (PHP, Forpsi webhosting)
header('Content-Type: application/json; charset=utf-8');

// Simple debug flag: add ?debug=1 to responses
$debug = (isset($_GET['debug']) && $_GET['debug'] === '1');

// DB config
$db_host = 'a066um.forpsi.com';
$db_user = 'f190888';
$db_pass = 'fHaFme9W';
$db_name = 'f190888';
$db_port = 3306;

// Connect
$conn = new mysqli($db_host, $db_user, $db_pass, $db_name, $db_port);
if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(['error' => 'DB connection failed', '_debug' => $debug ? $conn->connect_error : null]);
    exit;
}

// POST: submit score
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $userid = $conn->real_escape_string($data['userid'] ?? '');
    $nickname = $conn->real_escape_string($data['nickname'] ?? '');
    $score = intval($data['score'] ?? 0);
    $mode = $conn->real_escape_string($data['mode'] ?? 'SHOWDOWN');
    $characterId = $conn->real_escape_string($data['characterId'] ?? '');
    $level = intval($data['level'] ?? 0);
    $durationSec = intval($data['durationSec'] ?? 0);

    // REPLACE INTO: update or insert (7 placeholders)
    $sql = "REPLACE INTO leaderboard (userid, nickname, score, mode, characterId, level, durationSec, timeISO) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())";
    $stmt = $conn->prepare($sql);
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['error' => 'Prepare failed', '_debug' => $debug ? $conn->error : null]);
        $conn->close();
        exit;
    }

    // types: s = string, i = int
    $stmt->bind_param('ssissii', $userid, $nickname, $score, $mode, $characterId, $level, $durationSec);
    if ($stmt->execute()) {
        echo json_encode(['success' => true]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => $stmt->error]);
    }
    $stmt->close();
    $conn->close();
    exit;
}

// GET: fetch leaderboard
$mode = $conn->real_escape_string($_GET['mode'] ?? 'SHOWDOWN');
$characterId = $conn->real_escape_string($_GET['characterId'] ?? '');
$limit = intval($_GET['limit'] ?? 20);
$sql = "SELECT nickname, score, mode, characterId, level, durationSec, timeISO FROM leaderboard WHERE mode=? AND characterId=? ORDER BY score DESC LIMIT ?";
$stmt = $conn->prepare($sql);
if (!$stmt) {
    http_response_code(500);
    echo json_encode(['error' => 'Prepare failed', '_debug' => $debug ? $conn->error : null]);
    $conn->close();
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

$response = ['entries' => $entries];
if ($debug) {
    $response['_debug'] = ['sql' => $sql, 'count' => count($entries)];
}
echo json_encode($response);
?>
// Connect
$conn = new mysqli($db_host, $db_user, $db_pass, $db_name, $db_port);
if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(['error' => 'DB connection failed']);
    exit;
}

// POST: submit score
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $nickname = $conn->real_escape_string($data['nickname'] ?? '');
    $score = intval($data['score'] ?? 0);
    $mode = $conn->real_escape_string($data['mode'] ?? 'SHOWDOWN');
    $characterId = $conn->real_escape_string($data['characterId'] ?? '');
    $level = intval($data['level'] ?? 0);
    $durationSec = intval($data['durationSec'] ?? 0);
    // REPLACE INTO: update or insert
    $sql = "REPLACE INTO leaderboard (userId, nickname, score, mode, characterId, level, durationSec, timeISO) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ssissiis', $nickname, $nickname, $score, $mode, $characterId, $level, $durationSec);
    if ($stmt->execute()) {
        echo json_encode(['success' => true]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => $conn->error]);
    }
    $stmt->close();
    $conn->close();
    exit;
}

// GET: fetch leaderboard
$mode = $conn->real_escape_string($_GET['mode'] ?? 'SHOWDOWN');
$characterId = $conn->real_escape_string($_GET['characterId'] ?? '');
$limit = intval($_GET['limit'] ?? 20);
$sql = "SELECT nickname, score, mode, characterId, level, durationSec, timeISO FROM leaderboard WHERE mode=? AND characterId=? ORDER BY score DESC LIMIT ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('ssi', $mode, $characterId, $limit);
$stmt->execute();
$result = $stmt->get_result();
$entries = [];
while ($row = $result->fetch_assoc()) {
    $entries[] = $row;
}
$stmt->close();
$conn->close();
echo json_encode(['entries' => $entries]);
?>
