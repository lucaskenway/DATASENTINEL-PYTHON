from sklearn.ensemble import IsolationForest
import numpy as np

model = IsolationForest(contamination=0.1)

data = np.array([
    [5],
    [8],
    [10],
    [12],
    [50],
    [60]
])

model.fit(data)

def ai_detect(value):

    prediction = model.predict([[value]])

    return prediction[0] == -1
