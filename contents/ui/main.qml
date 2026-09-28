import QtQuick
import QtWebEngine
import org.kde.plasma.plasmoid
import org.kde.ksysguard.sensors as Sensors

// Plasma wallpaper that renders city.html and feeds it live system sensors once a second.
WallpaperItem {
    id: root

    WebEngineView {
        id: view
        anchors.fill: parent
        // The wallpaper must never take clicks or the context menu away from the desktop.
        enabled: false
        backgroundColor: "#05010f"
        // Only known theme names reach the URL; anything else falls back to bebop.
        url: Qt.resolvedUrl("city.html") + "?theme=" + (root.configuration.Theme === "neon" ? "neon" : "bebop")
        settings.showScrollBars: false
        // Over days the renderer can crash or be OOM-killed; bring the city back instead of leaving it blank.
        onRenderProcessTerminated: reloadTimer.start()
    }

    Timer {
        id: reloadTimer
        interval: 3000
        onTriggered: view.reload()
    }

    Sensors.Sensor { id: cpu; sensorId: "cpu/all/usage" }
    Sensors.Sensor { id: ram; sensorId: "memory/physical/usedPercent" }
    Sensors.Sensor { id: gpu; sensorId: "gpu/all/usage" }
    Sensors.Sensor { id: temp; sensorId: "cpu/all/averageTemperature" }
    Sensors.Sensor { id: diskRead; sensorId: "disk/all/read" }
    Sensors.Sensor { id: diskWrite; sensorId: "disk/all/write" }
    Sensors.Sensor { id: netDown; sensorId: "network/all/download" }
    Sensors.Sensor { id: netUp; sensorId: "network/all/upload" }

    Timer {
        interval: 1000
        running: true
        repeat: true
        onTriggered: {
            const m = {
                cpu: Number(cpu.value), ram: Number(ram.value), gpu: Number(gpu.value), temp: Number(temp.value),
                diskRead: Number(diskRead.value), diskWrite: Number(diskWrite.value),
                netDown: Number(netDown.value), netUp: Number(netUp.value)
            };
            view.runJavaScript("window.cityMetrics && window.cityMetrics(" + JSON.stringify(m) + ")");
        }
    }
}
