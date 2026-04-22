This is how I want the new app to work. A lot of these might overlap with the existing plan but there are subtle differences.
All icons taken from google material library.

The user flow will be a bit simplified.

The top session bar will contain:
the main project directory (user to browse)
a sequence: subdir of project - user to browse/create
a shot dir: subdir of sequence, user to create/browse + dropdown to see all shot dirs inside sequence.

onto the prompt section - split into columns

MODEL SETTINGS - as in original app, loaded from JSON.
PROJECT PROMPT - a prompt that gets added to all shot prompts. each prompt change should be saved on submission to fal into a json and browseable history (arrow back and fwd on that panel)
SHOT PROMPT - a prompt for the current shot. each prompt change should be saved on submission to fal into a json and browseable history (arrow back and fwd on that panel)
REFERENCE IMAGES - each thumbnail will have a zoom, remove and settings button. Zoom brings up the zoom modal, remove removes from ref panel, settings allows to set role for the image for multimodal models - roles would be (model dependant) source (for single image edits) / start frame / end frame / element_name - setting a start frame should clear that role from any other ref image. the role will be displayed at the top of the thumbnail.

I want the roles to allow me to - chose a start and end frame for video (exclusive roles which need to clear all others). choose which is the main (or first) image to upload (for editing like in nano banana), and also to assign a custom name to a selection of thumbnails to group them as a logical element in Kling (using it's roles system, one needs to be chosen as frontal)


RUN column will have a submit button and a cancel button and a text input to set the number of iterations to run the model multiple times.

The thumbnail gallery will remain close to original.
each thumbnail will have zoom - copy settings (which sets all the settings in the prompt section up to regenerate that thumbnail), copy prompt only, add to ref, delete image from disk.
each version colum has a delete folder from disk button.

There will be no big image preview on the main screen - this will be moved to the zoom modal.

