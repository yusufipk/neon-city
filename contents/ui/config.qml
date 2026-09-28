import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: root

    property string cfg_Theme
    // Plasma sets these on every wallpaper config page; declaring them avoids load warnings.
    property var configDialog
    property var wallpaperConfiguration

    QQC2.ComboBox {
        Kirigami.FormData.label: "Style:"
        textRole: "text"
        valueRole: "value"
        model: [
            { text: "Cowboy Bebop", value: "bebop" },
            { text: "Neon", value: "neon" }
        ]
        Component.onCompleted: currentIndex = Math.max(0, indexOfValue(root.cfg_Theme))
        onActivated: root.cfg_Theme = currentValue
    }
}
