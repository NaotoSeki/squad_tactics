import socket
import json

blender_code = """
import bpy
import json

response = "No match"
try:
    a = bpy.data.actions.get("Stand.Throw_Grenade")
    min_frame = 99999
    max_frame = -99999
    if a:
        for layer in a.layers:
            for strip in layer.strips:
                if hasattr(strip, "channelbags"):
                    for bag in strip.channelbags:
                        if hasattr(bag, "fcurves"):
                            for fc in bag.fcurves:
                                for kp in fc.keyframe_points:
                                    if kp.co[0] < min_frame: min_frame = kp.co[0]
                                    if kp.co[0] > max_frame: max_frame = kp.co[0]
                                    
    response = json.dumps({"range": [min_frame, max_frame]})
except Exception as e:
    response = str(e)

import socket
try:
    s = socket.socket()
    s.connect(('localhost', 9913))
    s.sendall(response.encode('utf-8'))
    s.close()
except:
    pass
"""

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 9876))
payload = {
    "type": "execute_code",
    "params": {"code": blender_code}
}
s.sendall(json.dumps(payload).encode('utf-8'))
s.close()
