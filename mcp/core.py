import logger

application = None
socket_client = None

def init(app, socket):
    global application, socket_client
    application = app
    socket_client = socket


def createCommand(action:str, options:dict) -> str:
    command = {
        "application":application,
        "action":action,
        "options":options
    }

    return command

def sendCommand(command:dict, timeout:int=None):

    response = socket_client.send_message_blocking(command, timeout=timeout)

    logger.log(f"Final response: {response['status']}")
    return response