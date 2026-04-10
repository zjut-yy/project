import re
from typing import Any, Dict, Set, Tuple

from ..models.constants import BIKE_CLASSES, OBJECT_CLASSES, PERSON_CLASSES, VEHICLE_CLASSES


VEHICLE_ANY_PAT = re.compile(r"(车辆|所有车辆|全部车辆|只看车辆|显示车辆|高亮车辆|车\\b|汽车|小车|轿车|卡车|货车|公交车|出租车|客车|van|bus|truck|car|vehicle)s?", re.IGNORECASE)
CAR_ONLY_PAT = re.compile(r"(汽车|小车|轿车|car)s?", re.IGNORECASE)
TRUCK_BUS_PAT = re.compile(r"(卡车|货车|公交车|bus|truck)s?", re.IGNORECASE)
PERSON_PAT = re.compile(r"(行人|人|pedestrian)s?", re.IGNORECASE)
OBJECT_PAT = re.compile(r"(object|物体|物件|物品|障碍物|箱子)s?", re.IGNORECASE)
BIKE_PAT = re.compile(r"(bike|bicycle|motorcycle|自行车|摩托车|电动车|单车)s?", re.IGNORECASE)
INTERACT_PAT = re.compile(r"(交互|interaction|接触|靠近|重叠)", re.IGNORECASE)


def parse_target_partner(user_text: str) -> Tuple[Set[int], str]:
    text = (user_text or "").lower()
    if VEHICLE_ANY_PAT.search(text):
        return VEHICLE_CLASSES, "车辆"
    if CAR_ONLY_PAT.search(text):
        return {2}, "汽车"
    if TRUCK_BUS_PAT.search(text):
        return {3}, "大型车辆"
    if OBJECT_PAT.search(text):
        return OBJECT_CLASSES, "物体"
    if BIKE_PAT.search(text):
        return BIKE_CLASSES, "自行车/摩托"
    return VEHICLE_CLASSES, "车辆"


def parse_user_intent(user_text: str) -> Dict[str, Any]:
    text = user_text or ""
    is_interaction = bool(INTERACT_PAT.search(text))

    selection_classes: Set[int] = set()
    selection_label = ""

    if VEHICLE_ANY_PAT.search(text) or CAR_ONLY_PAT.search(text) or TRUCK_BUS_PAT.search(text):
        selection_classes = set(VEHICLE_CLASSES)
        selection_label = "车辆"
        if CAR_ONLY_PAT.search(text):
            selection_classes = {2}
            selection_label = "汽车"
        elif TRUCK_BUS_PAT.search(text):
            selection_classes = {3}
            selection_label = "大型车辆"

    if OBJECT_PAT.search(text):
        selection_classes |= OBJECT_CLASSES
        selection_label = selection_label or "物体"
    if BIKE_PAT.search(text):
        selection_classes |= BIKE_CLASSES
        selection_label = selection_label or "自行车/摩托"
    if PERSON_PAT.search(text):
        selection_classes |= PERSON_CLASSES
        selection_label = selection_label or "行人"

    partner_classes, partner_label = parse_target_partner(text)
    return {
        "is_interaction": is_interaction,
        "selection_classes": selection_classes,
        "selection_label": selection_label,
        "partner_classes": partner_classes,
        "partner_label": partner_label,
    }
